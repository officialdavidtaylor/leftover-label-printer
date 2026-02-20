import { buildDeterministicPdf } from './minimal-pdf.ts';
import { resolveTemplate } from './template-registry.ts';

export type RenderPdfRequest = {
  templateId: string;
  templateVersion: string;
  payload: unknown;
};

export type RenderPdfResponse = {
  templateId: string;
  templateVersion: string;
  contentType: 'application/pdf';
  fileName: string;
  pdfBytes: Uint8Array;
};

export class UnknownTemplateError extends Error {
  constructor(templateId: string, templateVersion: string) {
    super(`unknown template ${templateId}@${templateVersion}`);
    this.name = 'UnknownTemplateError';
  }
}

export class TemplatePayloadValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super('template payload validation failed');
    this.name = 'TemplatePayloadValidationError';
    this.issues = issues;
  }
}

export function renderPdfTemplate(request: RenderPdfRequest): RenderPdfResponse {
  const template = resolveTemplate(request.templateId, request.templateVersion);
  if (!template) {
    throw new UnknownTemplateError(request.templateId, request.templateVersion);
  }

  const payloadResult = template.payloadSchema.safeParse(request.payload);
  if (!payloadResult.success) {
    const issues = payloadResult.error.issues.map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : 'payload';
      return `${path}: ${issue.message}`;
    });
    throw new TemplatePayloadValidationError(issues);
  }

  const lines = template.buildLines(payloadResult.data, template.assets);
  const pdfBytes = buildDeterministicPdf(template.layout, lines);

  return {
    templateId: request.templateId,
    templateVersion: request.templateVersion,
    contentType: 'application/pdf',
    fileName: `${request.templateId}-${request.templateVersion}.pdf`,
    pdfBytes,
  };
}
