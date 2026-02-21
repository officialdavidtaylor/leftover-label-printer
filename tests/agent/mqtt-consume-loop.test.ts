import { describe, expect, it, vi } from 'vitest';

import {
  consumePrinterJobCommands,
  getPrinterJobTopic,
  type MqttClient,
  type MqttPayload,
  type PrintJobCommand,
} from '../../agent/src/mqtt/consume-loop.ts';

describe('getPrinterJobTopic', () => {
  it('builds the printer command topic from printer id', () => {
    expect(getPrinterJobTopic('printer-01')).toBe('printers/printer-01/jobs');
  });

  it('rejects empty printer id values', () => {
    expect(() => getPrinterJobTopic('   ')).toThrow('printerId must be a non-empty string');
  });
});

describe('consumePrinterJobCommands', () => {
  it('subscribes to the printer job topic and processes command messages', async () => {
    const controller = new AbortController();
    let onMessage: ((payload: MqttPayload) => Promise<void>) | undefined;
    const onCommand = vi.fn(async () => undefined);

    const client: MqttClient = {
      connect: vi.fn(async () => ({
        subscribe: async (input) => {
          onMessage = input.onMessage;
          expect(input.topic).toBe('printers/printer-01/jobs');
        },
        waitForDisconnect: async (signal) => waitForAbort(signal),
      })),
    };

    const consumerPromise = consumePrinterJobCommands({
      printerId: 'printer-01',
      client,
      onCommand,
      signal: controller.signal,
      sleep: async () => undefined,
    });

    await vi.waitFor(() => {
      expect(onMessage).toBeDefined();
    });

    await onMessage?.(JSON.stringify(buildCommand({ eventId: 'evt-1', jobId: 'job-1' })));

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-1',
        jobId: 'job-1',
      })
    );

    controller.abort();
    await consumerPromise;
  });

  it('treats duplicate event ids as idempotent and ignores duplicate commands', async () => {
    const controller = new AbortController();
    let onMessage: ((payload: MqttPayload) => Promise<void>) | undefined;
    const onCommand = vi.fn(async () => undefined);

    const client: MqttClient = {
      connect: vi.fn(async () => ({
        subscribe: async (input) => {
          onMessage = input.onMessage;
        },
        waitForDisconnect: async (signal) => waitForAbort(signal),
      })),
    };

    const consumerPromise = consumePrinterJobCommands({
      printerId: 'printer-duplicate',
      client,
      onCommand,
      signal: controller.signal,
      sleep: async () => undefined,
    });

    await vi.waitFor(() => {
      expect(onMessage).toBeDefined();
    });

    const payload = JSON.stringify(buildCommand({ eventId: 'dup-evt-1', printerId: 'printer-duplicate' }));
    await onMessage?.(payload);
    await onMessage?.(payload);

    expect(onCommand).toHaveBeenCalledTimes(1);

    controller.abort();
    await consumerPromise;
  });

  it('retries failed connections with exponential backoff', async () => {
    const controller = new AbortController();
    const sleepDurations: number[] = [];
    let connectionAttempts = 0;

    const client: MqttClient = {
      connect: vi.fn(async () => {
        connectionAttempts += 1;

        if (connectionAttempts < 3) {
          throw new Error(`connect failed ${connectionAttempts}`);
        }

        return {
          subscribe: async () => undefined,
          waitForDisconnect: async () => {
            controller.abort();
            throw abortError();
          },
        };
      }),
    };

    await consumePrinterJobCommands({
      printerId: 'printer-backoff',
      client,
      onCommand: async () => undefined,
      signal: controller.signal,
      sleep: async (delayMs) => {
        sleepDurations.push(delayMs);
      },
      backoff: {
        initialMs: 100,
        maxMs: 1_000,
        multiplier: 2,
      },
    });

    expect(connectionAttempts).toBe(3);
    expect(sleepDurations).toEqual([100, 200]);
  });

  it('reconnects after disconnect events and re-subscribes to the same topic', async () => {
    const controller = new AbortController();
    const sleepDurations: number[] = [];
    const subscribedTopics: string[] = [];
    let connectionAttempts = 0;

    const client: MqttClient = {
      connect: vi.fn(async () => {
        connectionAttempts += 1;

        if (connectionAttempts === 1) {
          return {
            subscribe: async (input) => {
              subscribedTopics.push(input.topic);
            },
            waitForDisconnect: async () => undefined,
          };
        }

        return {
          subscribe: async (input) => {
            subscribedTopics.push(input.topic);
          },
          waitForDisconnect: async () => {
            controller.abort();
            throw abortError();
          },
        };
      }),
    };

    await consumePrinterJobCommands({
      printerId: 'printer-reconnect',
      client,
      onCommand: async () => undefined,
      signal: controller.signal,
      sleep: async (delayMs) => {
        sleepDurations.push(delayMs);
      },
      backoff: {
        initialMs: 50,
        maxMs: 500,
        multiplier: 2,
      },
    });

    expect(connectionAttempts).toBe(2);
    expect(subscribedTopics).toEqual([
      'printers/printer-reconnect/jobs',
      'printers/printer-reconnect/jobs',
    ]);
    expect(sleepDurations).toEqual([50]);
  });
});

function buildCommand(overrides: Partial<PrintJobCommand> = {}): PrintJobCommand {
  return {
    schemaVersion: '1.0.0',
    type: 'print_job_dispatch',
    eventId: 'evt-default',
    traceId: 'trace-default',
    jobId: 'job-default',
    printerId: 'printer-01',
    objectUrl: 'https://example.com/object.pdf',
    issuedAt: '2026-02-21T00:00:00.000Z',
    ...overrides,
  };
}

async function waitForAbort(signal?: AbortSignal): Promise<never> {
  if (!signal) {
    return Promise.reject(new Error('signal is required'));
  }

  if (signal.aborted) {
    throw abortError();
  }

  await new Promise<void>((_, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(abortError());
      },
      { once: true }
    );
  });

  throw abortError();
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}
