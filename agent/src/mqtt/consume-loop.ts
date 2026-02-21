import { z } from 'zod';

const printJobCommandSchema = z.object({
  schemaVersion: z.string().regex(/^1\.[0-9]+\.[0-9]+$/),
  type: z.literal('print_job_dispatch'),
  eventId: z.string().trim().min(1),
  traceId: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
  printerId: z.string().trim().min(1),
  objectUrl: z.string().url(),
  issuedAt: z.string().datetime(),
});

export type PrintJobCommand = z.infer<typeof printJobCommandSchema>;

export type MqttPayload = string | Uint8Array;

export type MqttSession = {
  subscribe(input: { topic: string; onMessage: (payload: MqttPayload) => Promise<void> }): Promise<void>;
  waitForDisconnect(signal?: AbortSignal): Promise<void>;
  disconnect?: () => Promise<void> | void;
};

export type MqttClient = {
  connect(signal?: AbortSignal): Promise<MqttSession>;
};

export type ConsumeLoopLogger = {
  info?: (event: string, context?: Record<string, unknown>) => void;
  warn?: (event: string, context?: Record<string, unknown>) => void;
};

export type ConsumeLoopOptions = {
  printerId: string;
  client: MqttClient;
  onCommand: (command: PrintJobCommand) => Promise<void>;
  signal?: AbortSignal;
  logger?: ConsumeLoopLogger;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  backoff?: Partial<{
    initialMs: number;
    maxMs: number;
    multiplier: number;
  }>;
  maxProcessedEventIds?: number;
};

type BackoffPolicy = {
  initialMs: number;
  maxMs: number;
  multiplier: number;
};

const DEFAULT_BACKOFF_POLICY: BackoffPolicy = {
  initialMs: 500,
  maxMs: 10_000,
  multiplier: 2,
};

export function getPrinterJobTopic(printerId: string): string {
  const normalizedPrinterId = printerId.trim();

  if (!normalizedPrinterId) {
    throw new Error('printerId must be a non-empty string');
  }

  return `printers/${normalizedPrinterId}/jobs`;
}

export async function consumePrinterJobCommands(options: ConsumeLoopOptions): Promise<void> {
  const printerId = options.printerId.trim();

  if (!printerId) {
    throw new Error('printerId must be a non-empty string');
  }

  const topic = getPrinterJobTopic(printerId);
  const logger = options.logger ?? {};
  const sleep = options.sleep ?? defaultSleep;
  const backoff = createBackoffState(options.backoff);
  const processedEventIds = new RecentEventIdCache(options.maxProcessedEventIds ?? 2048);
  const inFlightEventIds = new Set<string>();

  while (!options.signal?.aborted) {
    let session: MqttSession | null = null;

    try {
      session = await options.client.connect(options.signal);

      await session.subscribe({
        topic,
        onMessage: async (payload) => {
          const command = parsePrintJobCommand(payload, logger);

          if (!command || command.printerId !== printerId) {
            if (command && command.printerId !== printerId) {
              logger.warn?.('mqtt_command_printer_mismatch', {
                expectedPrinterId: printerId,
                receivedPrinterId: command.printerId,
                eventId: command.eventId,
              });
            }

            return;
          }

          if (processedEventIds.has(command.eventId) || inFlightEventIds.has(command.eventId)) {
            logger.info?.('mqtt_duplicate_command_ignored', {
              printerId,
              jobId: command.jobId,
              eventId: command.eventId,
            });
            return;
          }

          inFlightEventIds.add(command.eventId);

          try {
            await options.onCommand(command);
            processedEventIds.add(command.eventId);
          } finally {
            inFlightEventIds.delete(command.eventId);
          }
        },
      });

      backoff.reset();
      logger.info?.('mqtt_consumer_subscribed', { printerId, topic });
      await session.waitForDisconnect(options.signal);
      logger.warn?.('mqtt_session_disconnected', { printerId, topic });
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        return;
      }

      logger.warn?.('mqtt_consume_loop_error', {
        printerId,
        topic,
        error: toErrorMessage(error),
      });
    } finally {
      if (session?.disconnect) {
        try {
          await session.disconnect();
        } catch (error) {
          logger.warn?.('mqtt_disconnect_failed', {
            printerId,
            topic,
            error: toErrorMessage(error),
          });
        }
      }
    }

    if (options.signal?.aborted) {
      return;
    }

    const delayMs = backoff.nextDelayMs();
    logger.info?.('mqtt_reconnect_scheduled', { printerId, topic, delayMs });
    await sleep(delayMs, options.signal);
  }
}

async function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  if (signal?.aborted) {
    throw createAbortError();
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parsePrintJobCommand(payload: MqttPayload, logger: ConsumeLoopLogger): PrintJobCommand | null {
  let decodedPayload: unknown;

  try {
    decodedPayload = JSON.parse(toStringPayload(payload));
  } catch (error) {
    logger.warn?.('mqtt_command_decode_failed', { error: toErrorMessage(error) });
    return null;
  }

  const parsed = printJobCommandSchema.safeParse(decodedPayload);

  if (!parsed.success) {
    logger.warn?.('mqtt_command_schema_invalid', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return null;
  }

  return parsed.data;
}

function toStringPayload(payload: MqttPayload): string {
  if (typeof payload === 'string') {
    return payload;
  }

  return Buffer.from(payload).toString('utf8');
}

function createBackoffState(backoff: ConsumeLoopOptions['backoff']) {
  const policy = resolveBackoffPolicy(backoff);
  let nextDelayMs = policy.initialMs;

  return {
    reset(): void {
      nextDelayMs = policy.initialMs;
    },
    nextDelayMs(): number {
      const delayMs = nextDelayMs;
      const scaledDelay = Math.round(nextDelayMs * policy.multiplier);
      nextDelayMs = Math.min(policy.maxMs, Math.max(policy.initialMs, scaledDelay));
      return delayMs;
    },
  };
}

function resolveBackoffPolicy(backoff: ConsumeLoopOptions['backoff']): BackoffPolicy {
  const initialMs = Math.max(1, Math.trunc(backoff?.initialMs ?? DEFAULT_BACKOFF_POLICY.initialMs));
  const maxMs = Math.max(initialMs, Math.trunc(backoff?.maxMs ?? DEFAULT_BACKOFF_POLICY.maxMs));
  const multiplier = backoff?.multiplier ?? DEFAULT_BACKOFF_POLICY.multiplier;
  const normalizedMultiplier = Number.isFinite(multiplier) ? Math.max(1.25, multiplier) : 2;

  return {
    initialMs,
    maxMs,
    multiplier: normalizedMultiplier,
  };
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === 'AbortError';
}

function createAbortError(): Error {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

class RecentEventIdCache {
  private readonly eventIdSet = new Set<string>();
  private readonly eventIdQueue: string[] = [];

  constructor(private readonly capacity: number) {}

  has(eventId: string): boolean {
    return this.eventIdSet.has(eventId);
  }

  add(eventId: string): void {
    if (this.eventIdSet.has(eventId)) {
      return;
    }

    this.eventIdSet.add(eventId);
    this.eventIdQueue.push(eventId);

    while (this.eventIdQueue.length > this.capacity) {
      const oldestEventId = this.eventIdQueue.shift();

      if (oldestEventId) {
        this.eventIdSet.delete(oldestEventId);
      }
    }
  }
}
