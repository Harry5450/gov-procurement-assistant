import pccIndexJson from './data/pcc-template-index.json';
import type { TemplateRecord } from './types';

export interface OfficialTemplateObservation {
  sequence: number;
  name: string;
  officialDate: string;
}

interface OfficialTemplateIndex {
  sourceUrl: string;
  items: OfficialTemplateObservation[];
}

export type TemplateSyncStatus = 'current' | 'candidate' | 'untracked';

export const pccTemplateIndex = pccIndexJson as OfficialTemplateIndex;

function normalizeDate(value: string) {
  return value.replace(/\D/g, '');
}

export function getTemplateObservation(template: TemplateRecord) {
  return pccTemplateIndex.items.find((item) => item.name.trim() === template.name.trim());
}

export function getTemplateSyncStatus(template: TemplateRecord): TemplateSyncStatus {
  const observed = getTemplateObservation(template);
  if (!observed) return 'untracked';

  return normalizeDate(observed.officialDate) === normalizeDate(template.officialDate)
    ? 'current'
    : 'candidate';
}

export function formatRocDate(value: string) {
  const digits = normalizeDate(value);
  if (digits.length !== 7) return value;
  return `${digits.slice(0, 3)}/${digits.slice(3, 5)}/${digits.slice(5, 7)}`;
}
