import type { PdfTemplateDefinition } from './template-types.ts';
import { labelDefaultV1Template } from './templates/label-default/v1/template.ts';

const templates = [labelDefaultV1Template] as const;

const templateRegistry = new Map<string, PdfTemplateDefinition<unknown, unknown>>(
  templates.map((template) => [toTemplateKey(template.templateId, template.templateVersion), template])
);

export function resolveTemplate(
  templateId: string,
  templateVersion: string
): PdfTemplateDefinition<unknown, unknown> | null {
  return templateRegistry.get(toTemplateKey(templateId, templateVersion)) ?? null;
}

export function toTemplateKey(templateId: string, templateVersion: string): string {
  return `${templateId}@${templateVersion}`;
}
