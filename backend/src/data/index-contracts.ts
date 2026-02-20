export type SortDirection = 1 | -1;

export type IndexKey = Record<string, SortDirection>;

export type CollectionIndexContract = {
  collection: 'print_jobs' | 'job_events';
  name: string;
  key: IndexKey;
  unique?: boolean;
  sparse?: boolean;
  description: string;
};

export const IDEMPOTENCY_UNIQUENESS_SCOPE = 'global-idempotency-key' as const;

export const PRINT_JOB_INDEX_CONTRACTS: readonly CollectionIndexContract[] = [
  {
    collection: 'print_jobs',
    name: 'print_jobs_state_acceptedAt_desc',
    key: { state: 1, acceptedAt: -1 },
    description: 'Supports status-driven queue lookup and operator filtering by latest acceptance time.',
  },
  {
    collection: 'print_jobs',
    name: 'print_jobs_printerId_acceptedAt_desc',
    key: { printerId: 1, acceptedAt: -1 },
    description: 'Supports printer-specific job lookup and troubleshooting timelines.',
  },
  {
    collection: 'print_jobs',
    name: 'print_jobs_idempotencyKey_unique',
    key: { idempotencyKey: 1 },
    unique: true,
    description: 'Enforces single accepted job per idempotency key for deterministic retries.',
  },
];

export const JOB_EVENT_INDEX_CONTRACTS: readonly CollectionIndexContract[] = [
  {
    collection: 'job_events',
    name: 'job_events_jobId_occurredAt_asc',
    key: { jobId: 1, occurredAt: 1 },
    description: 'Supports timeline reads for GET /v1/print-jobs/{jobId}.',
  },
  {
    collection: 'job_events',
    name: 'job_events_eventId_unique',
    key: { eventId: 1 },
    unique: true,
    description: 'Supports event-level idempotency for duplicate status ingestion.',
  },
];

export const CRITICAL_INDEX_CONTRACTS: readonly CollectionIndexContract[] = [
  ...PRINT_JOB_INDEX_CONTRACTS,
  ...JOB_EVENT_INDEX_CONTRACTS,
];

export function findIndexContract(name: string): CollectionIndexContract | undefined {
  return CRITICAL_INDEX_CONTRACTS.find((index) => index.name === name);
}
