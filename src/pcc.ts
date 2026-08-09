import pccAssetsJson from './data/pcc-template-assets.json';
import pccIndexJson from './data/pcc-template-index.json';
import type { TemplateRecord } from './types';

export interface OfficialTemplateObservation {
  sequence: number;
  name: string;
  officialDate: string;
  detailUrl?: string;
}

interface OfficialTemplateIndex {
  sourceUrl: string;
  items: OfficialTemplateObservation[];
}

export interface ArchivedTemplateFile {
  format: 'docx' | 'odt' | 'pdf';
  path: string;
  sha256: string;
  size: number;
  sourceUrl: string;
  officialFilename: string;
}

export interface ArchivedTemplateVersion {
  version: string;
  title: string;
  files: ArchivedTemplateFile[];
}

export interface ArchivedTemplateRecord {
  id: string;
  name: string;
  detailUrl: string;
  latestObservedVersion: string;
  versions: ArchivedTemplateVersion[];
}

interface PccAssetManifest {
  schemaVersion: number;
  sourceIndexUrl: string;
  templates: ArchivedTemplateRecord[];
}

export type TemplateSyncStatus = 'current' | 'candidate' | 'untracked';

export const pccTemplateIndex = pccIndexJson as OfficialTemplateIndex;
export const pccAssetManifest = pccAssetsJson as PccAssetManifest;

function normalizeDate(value: string) {
  return value.replace(/\D/g, '');
}

export function getTemplateObservation(template: TemplateRecord) {
  return pccTemplateIndex.items.find((item) => item.name.trim() === template.name.trim());
}

export function getTemplateArchive(template: TemplateRecord) {
  return pccAssetManifest.templates.find((item) => item.id === template.id);
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
