import type { JobEventDocument } from '../data/schema-contracts.ts';

export function orderPrintJobEvents(events: readonly JobEventDocument[]): JobEventDocument[] {
  const ordered = [...events];
  ordered.sort((left, right) => {
    const leftTime = Date.parse(left.occurredAt);
    const rightTime = Date.parse(right.occurredAt);

    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    if (left.occurredAt !== right.occurredAt) {
      return left.occurredAt.localeCompare(right.occurredAt);
    }

    return left.eventId.localeCompare(right.eventId);
  });

  return ordered;
}
