import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  renderPdfTemplate,
  TemplatePayloadValidationError,
  UnknownTemplateError,
} from '../../backend/src/rendering/pdf-renderer.ts';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const goldenPdfPath = path.resolve(fileDir, './fixtures/golden/label-default-v1-sample.pdf');

describe('pdf-renderer', () => {
  it('renders deterministic bytes for template label-default@v1', () => {
    const request = {
      templateId: 'label-default',
      templateVersion: 'v1',
      payload: {
        itemName: 'Chili',
        datePrepared: '2026-02-20',
      },
    };

    const first = renderPdfTemplate(request);
    const second = renderPdfTemplate(request);

    const firstBytes = Buffer.from(first.pdfBytes);
    const secondBytes = Buffer.from(second.pdfBytes);
    const pdfText = firstBytes.toString('utf8');

    expect(secondBytes.equals(firstBytes)).toBe(true);
    expect(first.contentType).toBe('application/pdf');
    expect(first.fileName).toBe('label-default-v1.pdf');
    expect(pdfText).toContain('%PDF-1.4');
    expect(pdfText).toContain('/Type /Catalog');
    expect(pdfText).toContain('/Type /Page');
    expect(pdfText).toContain('/MediaBox [0 0 153 72]');
    expect(pdfText).toContain('(Chili) Tj');
    expect(pdfText).toContain('(prepared: 2026-02-20) Tj');
  });

  it('matches the golden PDF bytes for the sample payload', () => {
    const rendered = renderPdfTemplate({
      templateId: 'label-default',
      templateVersion: 'v1',
      payload: {
        itemName: 'Chili',
        datePrepared: '2026-02-20',
      },
    });

    const goldenPdf = fs.readFileSync(goldenPdfPath);
    expect(Buffer.from(rendered.pdfBytes)).toEqual(goldenPdf);
  });

  it('rejects unknown template references', () => {
    expect(() =>
      renderPdfTemplate({
        templateId: 'label-default',
        templateVersion: 'v99',
        payload: {
          itemName: 'Soup',
          datePrepared: '2026-02-20',
        },
      })
    ).toThrowError(UnknownTemplateError);
  });

  it('rejects invalid payloads with structured validation issues', () => {
    try {
      renderPdfTemplate({
        templateId: 'label-default',
        templateVersion: 'v1',
        payload: {
          itemName: '',
          datePrepared: '02/20/2026',
          quantity: 3,
        },
      });
      throw new Error('expected renderer to throw TemplatePayloadValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(TemplatePayloadValidationError);
      if (!(error instanceof TemplatePayloadValidationError)) {
        return;
      }

      expect(error.issues).toContain('itemName: Too small: expected string to have >=1 characters');
      expect(error.issues).toContain('datePrepared: expected YYYY-MM-DD');
      expect(error.issues).toContain('payload: Unrecognized key: "quantity"');
    }
  });
});
