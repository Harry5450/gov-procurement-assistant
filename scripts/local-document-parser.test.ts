import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import {
  DEFAULT_LOCAL_DOCUMENT_MAX_BYTES,
  LOCAL_DOCUMENT_ERROR_CODES,
  LocalDocumentParseError,
  decodeXmlEntities,
  detectLocalDocumentFormat,
  parseLocalDocument,
  parseLocalDocumentBytes,
  tryParseLocalDocument,
} from '../src/local-document-parser.ts';

function docxFixture(documentXml: string): Uint8Array {
  return zipSync({ 'word/document.xml': strToU8(documentXml) });
}

function odtFixture(contentXml: string): Uint8Array {
  return zipSync({
    mimetype: strToU8('application/vnd.oasis.opendocument.text'),
    'content.xml': strToU8(contentXml),
  });
}

test('detects supported and explicitly unsupported formats', () => {
  assert.equal(detectLocalDocumentFormat('需求說明書.DOCX'), 'docx');
  assert.equal(detectLocalDocumentFormat('contract.odt?download=1'), 'odt');
  assert.equal(detectLocalDocumentFormat('legacy.DOC'), 'doc');
  assert.equal(detectLocalDocumentFormat('scan.pdf'), 'pdf');
  assert.equal(detectLocalDocumentFormat('notes.txt'), 'unsupported');
});

test('decodes named and numeric XML entities deterministically', () => {
  assert.equal(decodeXmlEntities('&lt;ok&gt; &amp; &#39; &#x1F4C4;'), "<ok> & ' 📄");
  assert.equal(decodeXmlEntities('&#xD800;'), '\ufffd');
  assert.equal(decodeXmlEntities('&unknown;'), '&unknown;');
});

test('extracts DOCX paragraphs, tabs, line breaks, and table rows', () => {
  const bytes = docxFixture(`<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>第一段</w:t></w:r><w:r><w:t xml:space="preserve"> &amp; 第二段</w:t></w:r></w:p>
        <w:p><w:r><w:t>換行</w:t><w:br/><w:t>下一行</w:t><w:tab/><w:t>欄位</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>項目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>數量</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body>
    </w:document>`);
  const result = parseLocalDocumentBytes(bytes, 'fixture.docx');
  assert.equal(result.format, 'docx');
  assert.deepEqual(result.paragraphs, ['第一段 & 第二段', '換行\n下一行\t欄位', '項目\t數量']);
  assert.deepEqual(result.blocks.map((block) => block.kind), ['paragraph', 'paragraph', 'table-row']);
  assert.equal(result.text, '第一段 & 第二段\n換行\n下一行\t欄位\n項目\t數量');
  assert.equal(result.sourceXmlBytes > 0, true);
  assert.equal('bytes' in result, false);
});

test('extracts ODT headings, paragraphs, tabs, and repeated table rows', () => {
  const bytes = odtFixture(`<?xml version="1.0" encoding="UTF-8"?>
    <office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
      xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
      xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
      <office:body><office:text>
        <text:h>標題</text:h>
        <text:p>甲<text:s text:c="2"/>乙<text:tab/>丙 &amp; 丁<text:line-break/>戊</text:p>
        <table:table><table:table-row table:number-rows-repeated="2">
          <table:table-cell><text:p>欄一</text:p></table:table-cell>
          <table:table-cell><text:p>欄二</text:p></table:table-cell>
        </table:table-row><table:table-row>
          <table:covered-table-cell table:number-columns-repeated="2"/>
        </table:table-row></table:table>
      </office:text></office:body>
    </office:document-content>`);
  const result = parseLocalDocument({ fileName: 'fixture.odt', bytes });
  assert.equal(result.format, 'odt');
  assert.deepEqual(result.paragraphs, ['標題', '甲 乙\t丙 & 丁\n戊', '欄一\t欄二', '欄一\t欄二']);
  assert.deepEqual(result.blocks.map((block) => block.kind), ['paragraph', 'paragraph', 'table-row', 'table-row']);
});

test('rejects legacy .doc and PDF instead of returning fake text', () => {
  for (const [fileName, code] of [
    ['old.doc', LOCAL_DOCUMENT_ERROR_CODES.unsupportedLegacyDoc],
    ['scan.pdf', LOCAL_DOCUMENT_ERROR_CODES.unsupportedPdf],
  ] as const) {
    assert.throws(
      () => parseLocalDocument({ fileName, bytes: new Uint8Array([0x25, 0x50]) }),
      (error: unknown) => error instanceof LocalDocumentParseError && error.code === code,
    );
  }
});

test('returns stable error codes for empty, invalid, missing-part, and size limits', () => {
  const cases: Array<[string, Uint8Array, typeof LOCAL_DOCUMENT_ERROR_CODES[keyof typeof LOCAL_DOCUMENT_ERROR_CODES], Record<string, number> | undefined]> = [
    ['empty.docx', new Uint8Array(), LOCAL_DOCUMENT_ERROR_CODES.emptyFile, undefined],
    ['broken.docx', new Uint8Array([0x50, 0x4b, 0x03]), LOCAL_DOCUMENT_ERROR_CODES.invalidArchive, undefined],
    ['missing.docx', zipSync({ other: strToU8('x') }), LOCAL_DOCUMENT_ERROR_CODES.missingDocumentPart, undefined],
    ['large.docx', docxFixture('<w:document/>'), LOCAL_DOCUMENT_ERROR_CODES.fileTooLarge, { maxBytes: 1 }],
  ];
  for (const [fileName, bytes, code, options] of cases) {
    assert.throws(
      () => parseLocalDocument({ fileName, bytes }, options),
      (error: unknown) => error instanceof LocalDocumentParseError && error.code === code,
    );
  }
  assert.equal(DEFAULT_LOCAL_DOCUMENT_MAX_BYTES > 0, true);
});

test('enforces XML and extracted output limits and supports non-throwing UI boundary', () => {
  const bytes = docxFixture('<w:document><w:p><w:r><w:t>too long</w:t></w:r></w:p></w:document>');
  assert.throws(
    () => parseLocalDocument({ fileName: 'limit.docx', bytes }, { maxXmlBytes: 1 }),
    (error: unknown) => error instanceof LocalDocumentParseError && error.code === LOCAL_DOCUMENT_ERROR_CODES.xmlTooLarge,
  );
  assert.throws(
    () => parseLocalDocument({ fileName: 'limit.docx', bytes }, { maxOutputChars: 3 }),
    (error: unknown) => error instanceof LocalDocumentParseError && error.code === LOCAL_DOCUMENT_ERROR_CODES.outputTooLarge,
  );
  const outcome = tryParseLocalDocument({ fileName: 'limit.docx', bytes }, { maxOutputChars: 3 });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.error.code, LOCAL_DOCUMENT_ERROR_CODES.outputTooLarge);
});
