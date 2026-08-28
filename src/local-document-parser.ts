import { strFromU8, unzipSync } from 'fflate';

/**
 * The formats which this local parser can identify.  `doc` and `pdf` are
 * deliberately represented even though they are not parsed in this batch;
 * callers can show a precise conversion/fallback message instead of treating
 * an unsupported file as an empty document.
 */
export type LocalDocumentFormat = 'docx' | 'odt' | 'doc' | 'pdf' | 'unsupported';

export const LOCAL_DOCUMENT_ERROR_CODES = {
  emptyFile: 'EMPTY_FILE',
  fileTooLarge: 'FILE_TOO_LARGE',
  outputTooLarge: 'OUTPUT_TOO_LARGE',
  xmlTooLarge: 'XML_TOO_LARGE',
  unsupportedLegacyDoc: 'UNSUPPORTED_LEGACY_DOC',
  unsupportedPdf: 'UNSUPPORTED_PDF',
  unsupportedFormat: 'UNSUPPORTED_FORMAT',
  invalidArchive: 'INVALID_ARCHIVE',
  missingDocumentPart: 'MISSING_DOCUMENT_PART',
  invalidInput: 'INVALID_INPUT',
} as const;

export type LocalDocumentErrorCode =
  (typeof LOCAL_DOCUMENT_ERROR_CODES)[keyof typeof LOCAL_DOCUMENT_ERROR_CODES];

export const DEFAULT_LOCAL_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_LOCAL_DOCUMENT_MAX_OUTPUT_CHARS = 500_000;
export const DEFAULT_LOCAL_DOCUMENT_MAX_XML_BYTES = 16 * 1024 * 1024;

export interface LocalDocumentParserOptions {
  /** Maximum compressed input size accepted by the parser. */
  maxBytes?: number;
  /** Maximum UTF-16 code units in the extracted review text. */
  maxOutputChars?: number;
  /** Maximum uncompressed XML part size inspected from the ZIP archive. */
  maxXmlBytes?: number;
}

export interface LocalDocumentInput {
  /** The name is used only for format detection and display metadata. */
  fileName: string;
  /** Bytes are read and discarded by the caller after parsing; they are not retained in the result. */
  bytes: Uint8Array | ArrayBuffer;
}

export interface ParsedDocumentBlock {
  /** `paragraph` for normal text and `table-row` for a tab-separated row. */
  kind: 'paragraph' | 'table-row';
  text: string;
}

export interface ParsedLocalDocument {
  format: 'docx' | 'odt';
  fileName: string;
  /** Plain text suitable for human review. No original bytes are included. */
  text: string;
  paragraphs: string[];
  blocks: ParsedDocumentBlock[];
  /** Number of bytes in the selected XML part, before text extraction. */
  sourceXmlBytes: number;
}

export class LocalDocumentParseError extends Error {
  readonly code: LocalDocumentErrorCode;
  readonly format: LocalDocumentFormat;
  readonly fileName: string;

  constructor(
    code: LocalDocumentErrorCode,
    message: string,
    details: { format?: LocalDocumentFormat; fileName?: string } = {},
  ) {
    super(message);
    this.name = 'LocalDocumentParseError';
    this.code = code;
    this.format = details.format ?? 'unsupported';
    this.fileName = details.fileName ?? '';
  }
}

export type LocalDocumentParseOutcome =
  | { ok: true; value: ParsedLocalDocument }
  | { ok: false; error: LocalDocumentParseError };

/** Return the lower-case extension, without a leading dot. */
export function getLocalDocumentExtension(fileName: string): string {
  const name = String(fileName ?? '').trim().split(/[?#]/, 1)[0] ?? '';
  const baseName = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = baseName.lastIndexOf('.');
  if (dot <= 0 || dot === baseName.length - 1) return '';
  return baseName.slice(dot + 1).toLowerCase();
}

export function detectLocalDocumentFormat(fileName: string): LocalDocumentFormat {
  switch (getLocalDocumentExtension(fileName)) {
    case 'docx':
      return 'docx';
    case 'odt':
      return 'odt';
    case 'doc':
      return 'doc';
    case 'pdf':
      return 'pdf';
    default:
      return 'unsupported';
  }
}

function asBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('bytes must be a Uint8Array or ArrayBuffer');
}

function describeUnsupported(
  format: LocalDocumentFormat,
  fileName: string,
): LocalDocumentParseError {
  if (format === 'doc') {
    return new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.unsupportedLegacyDoc,
      'Legacy .doc files are not parsed in the browser. Save the document as .docx and import it again.',
      { format, fileName },
    );
  }
  if (format === 'pdf') {
    return new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.unsupportedPdf,
      'PDF text extraction is not included in this parser version; use a DOCX/ODT file or a later PDF import step.',
      { format, fileName },
    );
  }
  return new LocalDocumentParseError(
    LOCAL_DOCUMENT_ERROR_CODES.unsupportedFormat,
    `Unsupported document format for local import: ${getLocalDocumentExtension(fileName) || '(none)'}.`,
    { format, fileName },
  );
}

/** Decode XML entities without invoking a browser/server XML parser. */
export function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi,
    (entity, body: string) => {
      const lower = body.toLowerCase();
      if (lower === 'lt') return '<';
      if (lower === 'gt') return '>';
      if (lower === 'quot') return '"';
      if (lower === 'apos') return "'";
      if (lower === 'amp') return '&';

      const radix = lower.startsWith('#x') ? 16 : 10;
      const digits = lower.startsWith('#x') ? lower.slice(2) : lower.slice(1);
      const codePoint = Number.parseInt(digits, radix);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity;
      // XML cannot represent surrogate code points as scalar characters.
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return '\ufffd';
      return String.fromCodePoint(codePoint);
    },
  );
}

function localTagName(rawTag: string): string {
  const match = rawTag.match(/^<\/?\s*([A-Za-z_][\w:.-]*)/);
  if (!match) return '';
  const qualified = match[1];
  return qualified.slice(qualified.lastIndexOf(':') + 1).toLowerCase();
}

function isClosingTag(rawTag: string): boolean {
  return /^<\//.test(rawTag);
}

function isSelfClosingTag(rawTag: string): boolean {
  return /\/\s*>$/.test(rawTag);
}

function attributeValue(rawTag: string, localName: string): string | undefined {
  const escapedName = localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = rawTag.match(new RegExp(`(?:^|\\s)(?:[A-Za-z_][\\w.-]*:)?${escapedName}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match?.[1];
}

function normaliseInline(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    // Pretty-print indentation around XML children should not become content,
    // while tabs emitted by an explicit document control remain intact.
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function normaliseParagraph(value: string): string {
  return value
    .split('\n')
    .map((line) => normaliseInline(line))
    .filter((line, index, lines) => line.length > 0 || (index > 0 && index < lines.length - 1))
    .join('\n')
    .trim();
}

function boundedRepeatCount(rawTag: string): number {
  const value = Number.parseInt(attributeValue(rawTag, 'number-rows-repeated') ?? '1', 10);
  if (!Number.isFinite(value) || value < 1) return 1;
  // A malformed repeat count should not allocate an unbounded result.
  return Math.min(value, 10_000);
}

interface ExtractionState {
  paragraphs: string[];
  blocks: ParsedDocumentBlock[];
}

function pushParagraph(state: ExtractionState, value: string, inCell: boolean, cellParagraphs: string[]): void {
  const paragraph = normaliseParagraph(value);
  if (!paragraph) return;
  if (inCell) {
    cellParagraphs.push(paragraph);
  } else {
    state.paragraphs.push(paragraph);
    state.blocks.push({ kind: 'paragraph', text: paragraph });
  }
}

/** Extract DOCX paragraphs and table rows from word/document.xml. */
function extractWordXml(xml: string): ExtractionState {
  const state: ExtractionState = { paragraphs: [], blocks: [] };
  const tokens = xml.match(/<[^>]*>|[^<]+/g) ?? [];
  let paragraphOpen = false;
  let textOpen = false;
  let current = '';
  let inCell = false;
  let cellParagraphs: string[] = [];
  let rowCells: string[] = [];
  let rowOpen = false;

  const flushParagraph = () => {
    if (!paragraphOpen) return;
    pushParagraph(state, current, inCell, cellParagraphs);
    current = '';
    paragraphOpen = false;
    textOpen = false;
  };

  for (const token of tokens) {
    if (!token.startsWith('<')) {
      if (textOpen && paragraphOpen) current += decodeXmlEntities(token);
      continue;
    }
    const name = localTagName(token);
    const closing = isClosingTag(token);
    if (name === 'p') {
      if (closing) flushParagraph();
      else if (!isSelfClosingTag(token)) {
        flushParagraph();
        paragraphOpen = true;
        current = '';
      }
      continue;
    }
    if (name === 't' || name === 'deltext') {
      textOpen = !closing && !isSelfClosingTag(token);
      continue;
    }
    if (name === 'tab' && !closing && paragraphOpen) {
      current += '\t';
      continue;
    }
    if ((name === 'br' || name === 'cr') && !closing && paragraphOpen) {
      current += '\n';
      continue;
    }
    if (name === 'nocbreakhyphen' && !closing && paragraphOpen) {
      current += '-';
      continue;
    }
    if (name === 'tc') {
      if (!closing) {
        flushParagraph();
        inCell = true;
        cellParagraphs = [];
      } else {
        flushParagraph();
        if (inCell && rowOpen) rowCells.push(cellParagraphs.join('\n'));
        inCell = false;
        cellParagraphs = [];
      }
      continue;
    }
    if (name === 'tr') {
      if (!closing) {
        flushParagraph();
        rowOpen = true;
        rowCells = [];
      } else {
        flushParagraph();
        if (rowOpen) {
          const row = rowCells.map((cell) => cell.trim()).join('\t').trim();
          if (row) {
            state.paragraphs.push(row);
            state.blocks.push({ kind: 'table-row', text: row });
          }
        }
        rowOpen = false;
        rowCells = [];
      }
    }
  }
  flushParagraph();
  return state;
}

/** Extract ODT paragraphs/headings and table rows from content.xml. */
function extractOdtXml(xml: string): ExtractionState {
  const state: ExtractionState = { paragraphs: [], blocks: [] };
  const tokens = xml.match(/<[^>]*>|[^<]+/g) ?? [];
  let paragraphOpen = false;
  let current = '';
  let inCell = false;
  let cellParagraphs: string[] = [];
  let pendingCellRepeat = 1;
  let rowCells: string[] = [];
  let rowOpen = false;
  let pendingRowRepeat = 1;

  const flushParagraph = () => {
    if (!paragraphOpen) return;
    pushParagraph(state, current, inCell, cellParagraphs);
    current = '';
    paragraphOpen = false;
  };

  for (const token of tokens) {
    if (!token.startsWith('<')) {
      if (paragraphOpen) current += decodeXmlEntities(token);
      continue;
    }
    const name = localTagName(token);
    const closing = isClosingTag(token);
    const selfClosing = isSelfClosingTag(token);
    if (name === 'p' || name === 'h') {
      if (closing) flushParagraph();
      else if (!selfClosing) {
        flushParagraph();
        paragraphOpen = true;
        current = '';
      }
      continue;
    }
    if (name === 's' && !closing && paragraphOpen) {
      const count = Number.parseInt(attributeValue(token, 'c') ?? '1', 10);
      current += ' '.repeat(Number.isFinite(count) && count > 0 ? Math.min(count, 10_000) : 1);
      continue;
    }
    if (name === 'tab' && !closing && paragraphOpen) {
      current += '\t';
      continue;
    }
    if (name === 'line-break' && !closing && paragraphOpen) {
      current += '\n';
      continue;
    }
    if (name === 'table-cell') {
      if (!closing) {
        flushParagraph();
        inCell = true;
        cellParagraphs = [];
        const count = Number.parseInt(attributeValue(token, 'number-columns-repeated') ?? '1', 10);
        pendingCellRepeat = Number.isFinite(count) && count > 0 ? Math.min(count, 10_000) : 1;
      } else {
        flushParagraph();
        if (inCell && rowOpen) {
          const cell = cellParagraphs.join('\n');
          for (let repeat = 0; repeat < pendingCellRepeat; repeat += 1) rowCells.push(cell);
        }
        inCell = false;
        cellParagraphs = [];
        pendingCellRepeat = 1;
      }
      continue;
    }
    if (name === 'table-row') {
      if (!closing) {
        flushParagraph();
        rowOpen = true;
        rowCells = [];
        pendingRowRepeat = boundedRepeatCount(token);
      } else {
        flushParagraph();
        if (rowOpen) {
          const row = rowCells.map((cell) => cell.trim()).join('\t').trim();
          if (row) {
            for (let repeat = 0; repeat < pendingRowRepeat; repeat += 1) {
              state.paragraphs.push(row);
              state.blocks.push({ kind: 'table-row', text: row });
            }
          }
        }
        rowOpen = false;
        rowCells = [];
        pendingRowRepeat = 1;
      }
      continue;
    }
    // ODT can repeat a cell without duplicating its XML content.  Expanding
    // it here keeps simple price tables reviewable while retaining a hard cap.
    if (name === 'covered-table-cell' && !closing && rowOpen) {
      const count = Number.parseInt(attributeValue(token, 'number-columns-repeated') ?? '1', 10);
      const repeat = Number.isFinite(count) && count > 0 ? Math.min(count, 10_000) : 1;
      for (let index = 0; index < repeat; index += 1) rowCells.push('');
    }
  }
  flushParagraph();
  return state;
}

function parseArchive(
  input: LocalDocumentInput,
  format: 'docx' | 'odt',
  options: Required<Pick<LocalDocumentParserOptions, 'maxBytes' | 'maxOutputChars' | 'maxXmlBytes'>>,
): ParsedLocalDocument {
  const bytes = asBytes(input.bytes);
  if (bytes.byteLength === 0) {
    throw new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.emptyFile,
      'The selected document is empty.',
      { format, fileName: input.fileName },
    );
  }
  if (bytes.byteLength > options.maxBytes) {
    throw new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.fileTooLarge,
      `The selected document exceeds the local import limit of ${options.maxBytes} bytes.`,
      { format, fileName: input.fileName },
    );
  }
  // DOCX and ODT are ZIP containers.  Checking the signature first gives a
  // stable error for a renamed .doc/PDF rather than relying on fflate wording.
  if (bytes.byteLength < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.invalidArchive,
      `${format.toUpperCase()} is not a valid ZIP-based document.`,
      { format, fileName: input.fileName },
    );
  }

  const partPath = format === 'docx' ? 'word/document.xml' : 'content.xml';
  let archive: ReturnType<typeof unzipSync>;
  let oversizedXmlPart = false;
  try {
    // Only the document part is needed.  Besides reducing work, fflate's
    // filter lets us reject a ZIP bomb by its declared uncompressed size
    // before allocating the part's output buffer.
    archive = unzipSync(bytes, {
      filter: (file) => {
        if (file.name !== partPath) return false;
        if (file.originalSize > options.maxXmlBytes) {
          oversizedXmlPart = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.invalidArchive,
      `Unable to open the ${format.toUpperCase()} ZIP container.`,
      { format, fileName: input.fileName },
    );
  }
  if (oversizedXmlPart) {
    throw new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.xmlTooLarge,
      `The document XML exceeds the local import limit of ${options.maxXmlBytes} bytes.`,
      { format, fileName: input.fileName },
    );
  }
  const part = archive[partPath];
  if (!part) {
    throw new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.missingDocumentPart,
      `The ${format.toUpperCase()} document is missing ${partPath}.`,
      { format, fileName: input.fileName },
    );
  }
  if (part.byteLength > options.maxXmlBytes) {
    throw new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.xmlTooLarge,
      `The document XML exceeds the local import limit of ${options.maxXmlBytes} bytes.`,
      { format, fileName: input.fileName },
    );
  }

  const xml = strFromU8(part);
  const extracted = format === 'docx' ? extractWordXml(xml) : extractOdtXml(xml);
  const text = extracted.blocks.map((block) => block.text).join('\n');
  if (text.length > options.maxOutputChars) {
    throw new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.outputTooLarge,
      `Extracted text exceeds the local import limit of ${options.maxOutputChars} characters.`,
      { format, fileName: input.fileName },
    );
  }
  return {
    format,
    fileName: input.fileName,
    text,
    paragraphs: extracted.paragraphs,
    blocks: extracted.blocks,
    sourceXmlBytes: part.byteLength,
  };
}

function normaliseOptions(options: LocalDocumentParserOptions = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_LOCAL_DOCUMENT_MAX_BYTES;
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_LOCAL_DOCUMENT_MAX_OUTPUT_CHARS;
  const maxXmlBytes = options.maxXmlBytes ?? DEFAULT_LOCAL_DOCUMENT_MAX_XML_BYTES;
  if (![maxBytes, maxOutputChars, maxXmlBytes].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Document parser limits must be finite positive numbers.');
  }
  return {
    maxBytes: Math.floor(maxBytes),
    maxOutputChars: Math.floor(maxOutputChars),
    maxXmlBytes: Math.floor(maxXmlBytes),
  };
}

/** Parse a DOCX/ODT byte array synchronously, entirely in memory. */
export function parseLocalDocument(input: LocalDocumentInput, options: LocalDocumentParserOptions = {}): ParsedLocalDocument {
  const fileName = String(input?.fileName ?? '');
  const format = detectLocalDocumentFormat(fileName);
  if (format !== 'docx' && format !== 'odt') throw describeUnsupported(format, fileName);
  if (!input || input.bytes === undefined || input.bytes === null) {
    throw new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.invalidInput,
      'A document byte array is required.',
      { format, fileName },
    );
  }
  let bytes: Uint8Array | ArrayBuffer;
  try {
    bytes = asBytes(input.bytes);
  } catch {
    throw new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.invalidInput,
      'Document bytes must be a Uint8Array or ArrayBuffer.',
      { format, fileName },
    );
  }
  return parseArchive({ fileName, bytes }, format, normaliseOptions(options));
}

/** Convenience overload for callers that already have a filename and bytes. */
export function parseLocalDocumentBytes(
  bytes: Uint8Array | ArrayBuffer,
  fileName: string,
  options: LocalDocumentParserOptions = {},
): ParsedLocalDocument {
  return parseLocalDocument({ bytes, fileName }, options);
}

/** A non-throwing boundary suitable for UI import handlers. */
export function tryParseLocalDocument(
  input: LocalDocumentInput,
  options: LocalDocumentParserOptions = {},
): LocalDocumentParseOutcome {
  try {
    return { ok: true, value: parseLocalDocument(input, options) };
  } catch (error) {
    if (error instanceof LocalDocumentParseError) return { ok: false, error };
    return {
      ok: false,
      error: new LocalDocumentParseError(
        LOCAL_DOCUMENT_ERROR_CODES.invalidInput,
        error instanceof Error ? error.message : 'Unable to parse the selected document.',
        { fileName: String(input?.fileName ?? ''), format: detectLocalDocumentFormat(String(input?.fileName ?? '')) },
      ),
    };
  }
}

/** Read a browser File/Blob once, then delegate to the synchronous parser. */
export async function parseLocalDocumentFile(
  file: Blob & { name?: string },
  options: LocalDocumentParserOptions = {},
): Promise<ParsedLocalDocument> {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new LocalDocumentParseError(
      LOCAL_DOCUMENT_ERROR_CODES.invalidInput,
      'A browser File or Blob is required.',
    );
  }
  const fileName = String(file.name ?? '');
  const format = detectLocalDocumentFormat(fileName);
  if (format !== 'docx' && format !== 'odt') throw describeUnsupported(format, fileName);
  // The byte array is scoped to this call and is never attached to the result
  // or stored by this module.
  return parseLocalDocument({ fileName, bytes: await file.arrayBuffer() }, options);
}

/** Text-only convenience helper for simple review previews. */
export function extractLocalDocumentText(
  input: LocalDocumentInput,
  options: LocalDocumentParserOptions = {},
): string {
  return parseLocalDocument(input, options).text;
}
