import {
  printJobAcceptedResponseSchema,
  printJobStatusResponseSchema,
  type CreatePrintJobRequest,
  type PrintJobAcceptedResponse,
  type PrintJobStatusResponse,
} from '../schemas/print-jobs';
import { requestJson } from './http-client';

export function createPrintJob(
  accessToken: string,
  body: CreatePrintJobRequest
): Promise<PrintJobAcceptedResponse> {
  return requestJson({
    path: '/v1/print-jobs',
    method: 'POST',
    accessToken,
    body,
    expectedStatus: 202,
    schema: printJobAcceptedResponseSchema,
  });
}

export function getPrintJob(accessToken: string, jobId: string): Promise<PrintJobStatusResponse> {
  return requestJson({
    path: `/v1/print-jobs/${encodeURIComponent(jobId)}`,
    accessToken,
    expectedStatus: 200,
    schema: printJobStatusResponseSchema,
  });
}
