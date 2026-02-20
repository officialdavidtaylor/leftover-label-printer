import { z } from 'zod';

import type { PdfTemplateDefinition } from '../../../template-types.ts';
import { labelDefaultV1Assets } from './assets.ts';

const labelDefaultV1PayloadSchema = z.object({
  itemName: z.string().trim().min(1).max(64),
  datePrepared: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
}).strict();

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
  buildLines(payload) {
    return [payload.itemName, `prepared: ${payload.datePrepared}`];
  },
};
