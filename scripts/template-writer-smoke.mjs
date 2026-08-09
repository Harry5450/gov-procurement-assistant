import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

const TEMPLATE = 'official-templates/tender-instructions/1150727/tender-instructions.docx';

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const buffer = await readFile(TEMPLATE);
const archive = unzipSync(new Uint8Array(buffer));
const part = archive['word/document.xml'];
if (!part) throw new Error('Tender template has no word/document.xml');

const xml = strFromU8(part);
const text = [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
  .map((match) => decodeXml(match[1]))
  .join('')
  .replace(/\s+/g, ' ');

const requiredAnchors = [
  '本標案名稱：',
  '採購標的為：',
  '本採購預算金額',
  '招標方式為：',
  '押標金金額',
  '履約保證金金額',
  '決標原則：',
  '決標方式為：',
  '投標廠商之基本資格及應附具之證明文件如下',
  '(1)公開招標',
  '(2)選擇性招標',
  '(3)限制性招標',
  '公開取得書面報價或企劃書',
  '(1)最低標',
  '(2)最有利標',
  '(3)最高標',
  '(2-1)總價決標',
  '(2-2)分項決標',
  '(2-3)分組決標',
  '(2-4)依數量決標',
  '(2-5)單價決標',
];

const missing = requiredAnchors.filter((anchor) => !text.includes(anchor));
if (missing.length) {
  throw new Error(`Tender writer anchors missing from official DOCX: ${missing.join(' | ')}`);
}

const signature = buffer.subarray(0, 2).toString('ascii');
if (signature !== 'PK') throw new Error('Tender template is not a valid ZIP-based DOCX.');

console.log(`Tender template writer smoke OK: ${requiredAnchors.length} anchors verified in 1150727 DOCX.`);
