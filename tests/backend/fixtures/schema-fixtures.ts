import { faker } from '@faker-js/faker';

import type {
  JobEventDocument,
  PrinterDocument,
  PrintJobDocument,
  PrintJobState,
  TemplateDocument,
} from '../../../backend/src/data/schema-contracts.ts';

export function createPrintJobDocument(overrides: Partial<PrintJobDocument> = {}): PrintJobDocument {
  return {
    jobId: `job-${faker.string.alphanumeric(8).toLowerCase()}`,
    idempotencyKey: `idem-${faker.string.alphanumeric(10).toLowerCase()}`,
    state: 'pending',
    printerId: `printer-${faker.string.alphanumeric(6).toLowerCase()}`,
    templateId: `template-${faker.string.alphanumeric(6).toLowerCase()}`,
    templateVersion: `v${faker.number.int({ min: 1, max: 9 })}`,
    payload: {
      itemName: faker.commerce.productName(),
      prepDate: faker.date.recent().toISOString().slice(0, 10),
      expirationDate: faker.date.soon().toISOString().slice(0, 10),
    },
    traceId: faker.string.uuid(),
    acceptedAt: timestamp(),
    createdAt: timestamp(),
    updatedAt: timestamp(),
    ...overrides,
  };
}

export function createJobEventDocument(overrides: Partial<JobEventDocument> = {}): JobEventDocument {
  const state = overrides.type ?? 'pending';

  return {
    eventId: `event-${faker.string.alphanumeric(8).toLowerCase()}`,
    jobId: overrides.jobId ?? `job-${faker.string.alphanumeric(8).toLowerCase()}`,
    type: state,
    source: sourceForState(state),
    occurredAt: timestamp(),
    traceId: faker.string.uuid(),
    ...eventSpecificDefaults(state),
    ...overrides,
  };
}

export function createPrinterDocument(overrides: Partial<PrinterDocument> = {}): PrinterDocument {
  return {
    printerId: `printer-${faker.string.alphanumeric(6).toLowerCase()}`,
    nodeId: `node-${faker.string.alphanumeric(6).toLowerCase()}`,
    status: 'online',
    capabilities: {
      model: faker.company.name(),
      media: ['62mm'],
    },
    metadata: {
      location: faker.location.city(),
    },
    lastSeenAt: timestamp(),
    createdAt: timestamp(),
    updatedAt: timestamp(),
    ...overrides,
  };
}

export function createTemplateDocument(overrides: Partial<TemplateDocument> = {}): TemplateDocument {
  return {
    templateId: `template-${faker.string.alphanumeric(8).toLowerCase()}`,
    version: `v${faker.number.int({ min: 1, max: 9 })}`,
    name: faker.commerce.productName(),
    schemaVersion: '1.0.0',
    renderEngine: 'pdfkit',
    status: 'active',
    config: {
      pageSize: '62mmx100mm',
      locale: 'en-US',
    },
    createdAt: timestamp(),
    updatedAt: timestamp(),
    ...overrides,
  };
}

function sourceForState(state: PrintJobState): 'backend' | 'agent' {
  if (state === 'printed' || state === 'failed') {
    return 'agent';
  }

  return 'backend';
}

function eventSpecificDefaults(state: PrintJobState): Partial<JobEventDocument> {
  if (state === 'failed') {
    return {
      printerId: `printer-${faker.string.alphanumeric(6).toLowerCase()}`,
      outcome: 'failed',
      errorCode: 'printer_error',
      errorMessage: 'Printer reported a job failure',
    };
  }

  if (state === 'printed') {
    return {
      printerId: `printer-${faker.string.alphanumeric(6).toLowerCase()}`,
      outcome: 'printed',
    };
  }

  return {};
}

function timestamp(): string {
  return faker.date.recent({ days: 7 }).toISOString();
}
