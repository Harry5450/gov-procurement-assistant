import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatRocVersion,
  getActiveRegistryVersion,
  updateAnchorAuditVersion,
  updateActiveRegistry,
  updateSmokeVersion,
  validateTemplateId,
} from './pcc-promote.mjs';

const registryFixture = `export const templateRegistry = [
  {
    id: 'tender-instructions',
    officialDate: '114/12/31',
  },
  {
    id: 'service-contract',
    officialDate: '114/12/31',
  },
];
`;

test('formats a seven-digit ROC version without guessing', () => {
  assert.equal(formatRocVersion('1150727'), '115/07/27');
  assert.throws(() => formatRocVersion('20260727'), /7 碼民國日期/);
  assert.throws(() => formatRocVersion('115-07-27'), /7 碼民國日期/);
});

test('updates only the selected active Registry record', () => {
  const result = updateActiveRegistry(registryFixture, 'tender-instructions', '1150727');
  assert.equal(result.changed, true);
  assert.equal(result.previousVersion, '114/12/31');
  assert.match(result.text, /id: 'tender-instructions',[\s\S]*officialDate: '115\/07\/27'/);
  assert.match(result.text, /id: 'service-contract',[\s\S]*officialDate: '114\/12\/31'/);
  assert.equal(getActiveRegistryVersion(result.text, 'tender-instructions'), '1150727');
});

test('an already active version produces no file change', () => {
  const once = updateActiveRegistry(registryFixture, 'tender-instructions', '1150727');
  const twice = updateActiveRegistry(once.text, 'tender-instructions', '1150727');
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

test('rejects unknown templates and missing Registry records', () => {
  assert.throws(() => validateTemplateId('unknown-template'), /不支援的範本 ID/);
  assert.throws(() => updateActiveRegistry(registryFixture, 'goods-contract', '1141230'), /找不到範本/);
});

test('updates only the selected Anchor audit block when versions collide', () => {
  const fixture = `const templates = [
  {
    id: 'tender-instructions',
    version: '1150101',
    path: 'official-templates/tender-instructions/1150101/file.docx',
  },
  {
    id: 'service-contract',
    version: '1150101',
    path: 'official-templates/service-contract/1150101/file.odt',
  },
];`;
  const updated = updateAnchorAuditVersion(fixture, 'tender-instructions', '1150101', '1150202');
  assert.match(updated, /id: 'tender-instructions',[\s\S]*version: '1150202'/);
  assert.match(updated, /id: 'service-contract',[\s\S]*version: '1150101'/);
});

test('updates only the selected smoke path and status message', () => {
  const fixture = `
const TENDER_TEMPLATE = 'official-templates/tender-instructions/1150101/file.docx';
const SERVICE_TEMPLATE = 'official-templates/service-contract/1150101/file.odt';
console.log('verified in 1150101 DOCX');
console.log('verified in 1150101 ODT');`;
  const updated = updateSmokeVersion(fixture, 'tender-instructions', '1150101', '1150202');
  assert.match(updated, /tender-instructions\/1150202/);
  assert.match(updated, /service-contract\/1150101/);
  assert.match(updated, /verified in 1150202 DOCX/);
  assert.match(updated, /verified in 1150101 ODT/);
});
