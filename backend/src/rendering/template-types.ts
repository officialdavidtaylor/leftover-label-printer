import type { z } from 'zod';

export type PdfTemplateLayout = {
  pageWidth: number;
  pageHeight: number;
  fontSize: number;
  lineHeight: number;
  originX: number;
  originY: number;
};

export type PdfTemplateDefinition<TPayload, TAssets> = {
  templateId: string;
  templateVersion: string;
  payloadSchema: z.ZodType<TPayload>;
  assets: TAssets;
  layout: PdfTemplateLayout;
  buildLines(payload: TPayload, assets: TAssets): string[];
};
