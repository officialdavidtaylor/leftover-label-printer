import { Buffer } from 'node:buffer';

import {
  consumePrinterStatusEvent,
  type PrinterStatusConsumeResult,
  type PrinterStatusLogRecord,
  type PrinterStatusStore,
} from './printer-status-consumer.ts';

export const PRINTER_STATUS_TOPIC_FILTER = 'printers/+/status';

export type PrinterStatusSubscriptionLogRecord =
  | PrinterStatusLogRecord
  | {
      event: 'printer_status_subscription';
      result: 'subscribed' | 'subscribe_failed' | 'payload_invalid';
      topicFilter?: string;
      topic?: string;
      message?: string;
    };

export interface PrinterStatusSubscriberClient {
  subscribe(topicFilter: string, options: { qos: 1 }, callback: (error?: Error | null) => void): void;
  on(event: 'message', listener: (topic: string, payload: Buffer | Uint8Array) => void): void;
}

export async function subscribeToPrinterStatusEvents(deps: {
  client: PrinterStatusSubscriberClient;
  store: PrinterStatusStore;
  onLog?: (entry: PrinterStatusSubscriptionLogRecord) => void;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    deps.client.subscribe(PRINTER_STATUS_TOPIC_FILTER, { qos: 1 }, (error) => {
      if (error) {
        deps.onLog?.({
          event: 'printer_status_subscription',
          result: 'subscribe_failed',
          topicFilter: PRINTER_STATUS_TOPIC_FILTER,
          message: error.message,
        });
        reject(error);
        return;
      }

      deps.onLog?.({
        event: 'printer_status_subscription',
        result: 'subscribed',
        topicFilter: PRINTER_STATUS_TOPIC_FILTER,
      });
      resolve();
    });
  });

  deps.client.on('message', (topic, payload) => {
    void handlePrinterStatusMessage(
      {
        topic,
        payload,
      },
      {
        store: deps.store,
        onLog: deps.onLog,
      }
    );
  });
}

export async function handlePrinterStatusMessage(
  input: {
    topic: string;
    payload: Buffer | Uint8Array;
  },
  deps: {
    store: PrinterStatusStore;
    onLog?: (entry: PrinterStatusSubscriptionLogRecord) => void;
  }
): Promise<PrinterStatusConsumeResult> {
  const payload = parseJsonPayload(input.payload);
  if (!payload.ok) {
    deps.onLog?.({
      event: 'printer_status_subscription',
      result: 'payload_invalid',
      topic: input.topic,
      message: payload.message,
    });
    return {
      status: 'rejected',
      reason: 'payload_invalid',
      message: payload.message,
    };
  }

  return consumePrinterStatusEvent(
    {
      topic: input.topic,
      payload: payload.value,
    },
    {
      store: deps.store,
      onLog: deps.onLog,
    }
  );
}

function parseJsonPayload(
  payload: Buffer | Uint8Array
): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return {
      ok: true,
      value: JSON.parse(Buffer.from(payload).toString('utf8')),
    };
  } catch {
    return {
      ok: false,
      message: 'printer status payload must be valid JSON',
    };
  }
}
