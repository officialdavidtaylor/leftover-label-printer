import { describe, expect, it } from 'vitest';

import {
  assertJsonResponseMatchesContract,
  getDeclaredResponseStatusCodes,
  type OpenApiProviderContract,
} from './helpers/openapi-provider-contract.ts';

const sampleContract: OpenApiProviderContract = {
  paths: {
    '/v1/sample': {
      post: {
        operationId: 'createSample',
        responses: {
          '202': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'state'],
                  properties: {
                    id: { type: 'string' },
                    state: {
                      type: 'string',
                      enum: ['accepted', 'replayed'],
                    },
                  },
                },
              },
            },
          },
          '400': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code', 'message'],
                  properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

describe('provider-contract-harness', () => {
  it('returns declared status codes in sorted order', () => {
    expect(getDeclaredResponseStatusCodes(sampleContract, '/v1/sample', 'post')).toEqual([202, 400]);
  });

  it('throws a detailed error when status is missing from contract', () => {
    expect(() =>
      assertJsonResponseMatchesContract({
        contract: sampleContract,
        routePath: '/v1/sample',
        method: 'post',
        status: 500,
        body: { code: 'oops' },
      })
    ).toThrow('[contract:createSample] status 500 is not declared');
  });

  it('throws schema violation details when required fields are missing', () => {
    expect(() =>
      assertJsonResponseMatchesContract({
        contract: sampleContract,
        routePath: '/v1/sample',
        method: 'post',
        status: 202,
        body: { id: 'sample-1' },
      })
    ).toThrow('response.body.state is required');
  });
});
