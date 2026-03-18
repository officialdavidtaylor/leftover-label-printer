export function buildIdempotencyKey(): string {
  return `frontend-${crypto.randomUUID()}`;
}
