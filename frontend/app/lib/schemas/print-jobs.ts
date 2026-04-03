import { z } from 'zod';

export const creatorFormSchema = z.object({
  itemName: z.string().trim().min(1).max(64),
  datePrepared: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
});

export const createPrintJobRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1),
  printerId: z.string().trim().min(1),
  templateId: z.string().trim().min(1),
  templateVersion: z.string().trim().min(1),
  payload: creatorFormSchema,
});

export const printJobAcceptedResponseSchema = z.object({
  jobId: z.string().trim().min(1),
  state: z.enum(['pending', 'processing', 'dispatched', 'printed', 'failed']),
  acceptedAt: z.string().trim().min(1),
  traceId: z.string().trim().min(1).optional(),
});

export const printJobEventSchema = z.object({
  eventId: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
  type: z.enum(['pending', 'processing', 'dispatched', 'printed', 'failed']),
  source: z.enum(['backend', 'agent']),
  printerId: z.string().trim().min(1).optional(),
  occurredAt: z.string().trim().min(1),
  traceId: z.string().trim().min(1).optional(),
  errorCode: z.string().trim().min(1).optional(),
});

export const printJobStatusResponseSchema = z.object({
  jobId: z.string().trim().min(1),
  state: z.enum(['pending', 'processing', 'dispatched', 'printed', 'failed']),
  printerId: z.string().trim().min(1),
  templateId: z.string().trim().min(1),
  templateVersion: z.string().trim().min(1).optional(),
  events: z.array(printJobEventSchema),
});

export const errorResponseSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  traceId: z.string().trim().min(1).optional(),
});

export type CreatorFormValues = z.infer<typeof creatorFormSchema>;
export type CreatePrintJobRequest = z.infer<typeof createPrintJobRequestSchema>;
export type PrintJobAcceptedResponse = z.infer<typeof printJobAcceptedResponseSchema>;
export type PrintJobEvent = z.infer<typeof printJobEventSchema>;
export type PrintJobStatusResponse = z.infer<typeof printJobStatusResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
