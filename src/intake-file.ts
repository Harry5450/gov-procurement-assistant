/**
 * Local-only metadata checks for a requirements document.
 *
 * This module deliberately does not read a File's bytes.  Keeping the first
 * step metadata-only makes the GitHub Pages build safe by default: a selected
 * document is not uploaded, parsed, or sent to an external service here.
 */

export const DEFAULT_INTAKE_FILE_MAX_BYTES = 25 * 1024 * 1024;

export const SUPPORTED_INTAKE_FILE_EXTENSIONS = ['docx', 'odt', 'pdf'] as const;
export const LEGACY_INTAKE_FILE_EXTENSIONS = ['doc'] as const;

/** Value suitable for a file input's `accept` attribute. */
export const INTAKE_FILE_ACCEPT = [
  ...SUPPORTED_INTAKE_FILE_EXTENSIONS.map((extension) => `.${extension}`),
  ...LEGACY_INTAKE_FILE_EXTENSIONS.map((extension) => `.${extension}`),
].join(',');

export type SupportedIntakeFileExtension = (typeof SUPPORTED_INTAKE_FILE_EXTENSIONS)[number];
export type IntakeFileKind = SupportedIntakeFileExtension | 'legacy-doc' | 'unsupported';

/** The subset of File metadata needed by this module. */
export interface IntakeFileInput {
  name: string;
  size: number;
  type?: string;
  lastModified?: number;
}

export interface IntakeFileMetadata {
  name: string;
  size: number;
  mimeType: string;
  lastModified?: number;
  extension: string;
  kind: IntakeFileKind;
  supported: boolean;
  requiresConversion: boolean;
}

export interface IntakeFileValidationOptions {
  maxBytes?: number;
}

export interface IntakeFileValidationResult {
  /** True only when the file can proceed to a later local import step. */
  ok: boolean;
  metadata: IntakeFileMetadata;
  issues: string[];
  advisories: string[];
}

/**
 * Return a lower-case extension without the leading dot.
 *
 * A path is not expected from a browser File, but stripping path segments
 * keeps this helper deterministic when it is used by tests or import code.
 */
export function getFileExtension(fileName: string): string {
  const name = fileName.trim().split(/[?#]/, 1)[0] ?? '';
  const baseName = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = baseName.lastIndexOf('.');
  if (dot <= 0 || dot === baseName.length - 1) return '';
  return baseName.slice(dot + 1).toLowerCase();
}

export function classifyIntakeFile(fileOrName: Pick<IntakeFileInput, 'name'> | string): IntakeFileKind {
  const extension = getFileExtension(typeof fileOrName === 'string' ? fileOrName : fileOrName.name);
  if ((SUPPORTED_INTAKE_FILE_EXTENSIONS as readonly string[]).includes(extension)) {
    return extension as SupportedIntakeFileExtension;
  }
  if (extension === 'doc') return 'legacy-doc';
  return 'unsupported';
}

const FILE_GUIDANCE: Record<IntakeFileKind, string> = {
  docx: 'DOCX 可在後續步驟於本機擷取文字與表格，並由您逐項確認。',
  odt: 'ODT 可在後續步驟於本機擷取文字與表格，並由您逐項確認。',
  pdf: 'PDF 可附加為需求來源；本版尚不自動擷取文字，請人工補登並確認。',
  'legacy-doc': '舊式 .doc 無法在 GitHub Pages 可靠解析，請先另存為 .docx。',
  unsupported: '此格式不在支援清單，請改用 DOCX、ODT 或文字型 PDF。',
};

const EXPECTED_MIME_TYPES: Partial<Record<SupportedIntakeFileExtension, string>> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  pdf: 'application/pdf',
};

function normaliseSize(size: number): number {
  return Number.isFinite(size) && size >= 0 ? size : 0;
}

/** Build metadata only; no file contents are inspected. */
export function getIntakeFileMetadata(file: IntakeFileInput): IntakeFileMetadata {
  const extension = getFileExtension(file.name);
  const kind = classifyIntakeFile(file);
  const supported = (SUPPORTED_INTAKE_FILE_EXTENSIONS as readonly string[]).includes(kind);

  return {
    name: file.name,
    size: normaliseSize(file.size),
    mimeType: file.type?.trim() ?? '',
    lastModified: file.lastModified,
    extension,
    kind,
    supported,
    requiresConversion: kind === 'legacy-doc',
  };
}

/**
 * Validate metadata for the first intake step.
 *
 * A valid result means format and size are acceptable, not that the document
 * content is complete or legally sufficient.  Content extraction and human
 * confirmation belong to later workflow steps.
 */
export function validateIntakeFile(
  file: IntakeFileInput,
  options: IntakeFileValidationOptions = {},
): IntakeFileValidationResult {
  const metadata = getIntakeFileMetadata(file);
  const maxBytes = options.maxBytes ?? DEFAULT_INTAKE_FILE_MAX_BYTES;
  const issues: string[] = [];
  const advisories: string[] = [FILE_GUIDANCE[metadata.kind]];

  if (!Number.isFinite(file.size) || file.size < 0) {
    issues.push('無法確認檔案大小，請重新選擇檔案。');
  } else if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    issues.push('檔案大小限制設定無效。');
  } else if (file.size > maxBytes) {
    issues.push(`檔案大小超過限制（${formatFileSize(maxBytes)}）。`);
  }

  if (!metadata.supported) {
    issues.push(metadata.kind === 'legacy-doc'
      ? '這是舊式 .doc 檔，請另存為 .docx 後再上傳。'
      : metadata.extension
        ? `不支援 .${metadata.extension} 檔案。`
        : '檔案沒有可辨識的副檔名。');
  }

  if (metadata.supported && metadata.kind !== 'pdf' && !metadata.name.trim()) {
    issues.push('檔案名稱不可為空白。');
  }

  if (metadata.kind === 'docx' || metadata.kind === 'odt' || metadata.kind === 'pdf') {
    const expectedMimeType = EXPECTED_MIME_TYPES[metadata.kind];
    if (metadata.mimeType && expectedMimeType && metadata.mimeType !== expectedMimeType) {
      advisories.push('瀏覽器提供的 MIME 類型與副檔名不同，系統仍以副檔名檢查；請確認檔案內容。');
    }
  }

  return {
    ok: issues.length === 0,
    metadata,
    issues,
    advisories,
  };
}

export function isSupportedIntakeFile(
  file: IntakeFileInput,
  options?: IntakeFileValidationOptions,
): boolean {
  return validateIntakeFile(file, options).ok;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
