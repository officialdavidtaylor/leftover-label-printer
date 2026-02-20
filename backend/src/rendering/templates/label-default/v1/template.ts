import { z } from 'zod';

import type { PdfTemplateDefinition } from '../../../template-types.ts';
import { labelDefaultV1Assets } from './assets.ts';

const labelDefaultV1PayloadSchema = z.object({
  itemName: z.string().trim().min(1).max(64),
  quantity: z.number().int().positive().max(999).default(1),
  unit: z.string().trim().min(1).max(16).optional(),
  preparedBy: z.string().trim().min(1).max(64).optional(),
  notes: z.string().trim().max(120).optional(),
});

type LabelDefaultV1Payload = z.infer<typeof labelDefaultV1PayloadSchema>;

export const labelDefaultV1Template: PdfTemplateDefinition<
  LabelDefaultV1Payload,
  typeof labelDefaultV1Assets
> = {
  templateId: 'label-default',
  templateVersion: 'v1',
  payloadSchema: labelDefaultV1PayloadSchema,
  assets: labelDefaultV1Assets,
  layout: labelDefaultV1Assets.layout,
  buildLines(payload, assets) {
    const quantityText = payload.unit
      ? `${payload.quantity} ${payload.unit}`
      : String(payload.quantity);

    return [
      assets.templateName,
      `Item: ${payload.itemName}`,
      `Qty: ${quantityText}`,
      `Prepared by: ${payload.preparedBy ?? 'N/A'}`,
      `Notes: ${payload.notes ?? 'N/A'}`,
      assets.footerNote,
    ];
  },
};
