import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_INTAKE_FILE_MAX_BYTES,
  INTAKE_FILE_ACCEPT,
  classifyIntakeFile,
  getFileExtension,
  getIntakeFileMetadata,
  isSupportedIntakeFile,
  validateIntakeFile,
} from '../src/intake-file.ts';

test('extracts a lower-case extension without treating dotfiles as documents', () => {
  assert.equal(getFileExtension('需求說明書.DOCX'), 'docx');
  assert.equal(getFileExtension('C:\\案件\\需求.odt'), 'odt');
  assert.equal(getFileExtension('/tmp/requirements.pdf?download=1'), 'pdf');
  assert.equal(getFileExtension('.docx'), '');
  assert.equal(getFileExtension('requirements.'), '');
  assert.equal(getFileExtension('requirements'), '');
});

test('classifies supported formats and legacy .doc separately', () => {
  assert.equal(classifyIntakeFile('requirements.docx'), 'docx');
  assert.equal(classifyIntakeFile('requirements.odt'), 'odt');
  assert.equal(classifyIntakeFile('requirements.pdf'), 'pdf');
  assert.equal(classifyIntakeFile('legacy.DOC'), 'legacy-doc');
  assert.equal(classifyIntakeFile('requirements.rtf'), 'unsupported');
});

test('validates metadata without reading or uploading file contents', () => {
  let contentsRead = false;
  const metadataOnlyFile = {
    name: 'requirements.docx',
    size: 12_345,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    get arrayBuffer() {
      contentsRead = true;
      throw new Error('content must not be read during metadata validation');
    },
  };

  const result = validateIntakeFile(metadataOnlyFile);

  assert.equal(result.ok, true);
  assert.equal(result.metadata.kind, 'docx');
  assert.equal(contentsRead, false);
  assert.equal('arrayBuffer' in result.metadata, false);
});

test('legacy .doc returns a conversion instruction and cannot proceed', () => {
  const result = validateIntakeFile({ name: 'old-tender.doc', size: 1_000 });

  assert.equal(result.ok, false);
  assert.equal(result.metadata.kind, 'legacy-doc');
  assert.equal(result.metadata.requiresConversion, true);
  assert.match(result.issues.join(' '), /另存為 .docx/);
  assert.match(result.advisories.join(' '), /舊式 .doc/);
});

test('unsupported extension and oversize files are rejected', () => {
  const unsupported = validateIntakeFile({ name: 'requirements.txt', size: 1_000 });
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.issues.join(' '), /不支援/);

  const tooLarge = validateIntakeFile({
    name: 'requirements.pdf',
    size: DEFAULT_INTAKE_FILE_MAX_BYTES + 1,
  });
  assert.equal(tooLarge.ok, false);
  assert.match(tooLarge.issues.join(' '), /超過限制/);
});

test('MIME mismatch is an advisory, not a false rejection', () => {
  const result = validateIntakeFile({
    name: 'requirements.pdf',
    size: 500,
    type: 'application/octet-stream',
  });

  assert.equal(result.ok, true);
  assert.match(result.advisories.join(' '), /MIME/);
  assert.equal(isSupportedIntakeFile({ name: 'requirements.pdf', size: 500 }), true);
});

test('metadata preserves name, size, MIME type and extension only', () => {
  const metadata = getIntakeFileMetadata({
    name: 'specification.ODT',
    size: 20_000,
    type: 'application/vnd.oasis.opendocument.text',
    lastModified: 1_700_000_000_000,
  });

  assert.deepEqual(metadata, {
    name: 'specification.ODT',
    size: 20_000,
    mimeType: 'application/vnd.oasis.opendocument.text',
    lastModified: 1_700_000_000_000,
    extension: 'odt',
    kind: 'odt',
    supported: true,
    requiresConversion: false,
  });
  assert.match(INTAKE_FILE_ACCEPT, /.docx/);
  assert.match(INTAKE_FILE_ACCEPT, /.doc/);
});
