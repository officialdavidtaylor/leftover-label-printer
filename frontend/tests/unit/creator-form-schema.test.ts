import { describe, expect, it } from 'vitest';

import { creatorFormSchema } from '../../app/lib/schemas/print-jobs';

describe('creatorFormSchema', () => {
  it('accepts the MVP payload fields', () => {
    expect(
      creatorFormSchema.parse({
        itemName: 'Chicken soup',
        datePrepared: '2026-03-18',
      })
    ).toEqual({
      itemName: 'Chicken soup',
      datePrepared: '2026-03-18',
    });
  });

  it('rejects invalid dates and empty item names', () => {
    const result = creatorFormSchema.safeParse({
      itemName: '',
      datePrepared: '03/18/2026',
    });

    expect(result.success).toBe(false);
  });
});
