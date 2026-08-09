import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

const TENDER_TEMPLATE = 'official-templates/tender-instructions/1150727/tender-instructions.docx';
const SERVICE_TEMPLATE = 'official-templates/service-contract/1141231/service-contract.odt';

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function wordParagraphText(paragraphXml) {
  return [...paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function odtBlockText(blockXml) {
  return decodeXml(
    blockXml
      .replace(/<text:s\b[^>]*text:c="(\d+)"[^>]*\/>/g, (_match, count) => ' '.repeat(Number(count)))
      .replace(/<text:s\b[^>]*\/>/g, ' ')
      .replace(/<text:tab\b[^>]*\/>/g, '\t')
      .replace(/<text:line-break\b[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\s+/g, ' ').trim();
}

async function verifyTenderWriter() {
  const buffer = await readFile(TENDER_TEMPLATE);
  const archive = unzipSync(new Uint8Array(buffer));
  const part = archive['word/document.xml'];
  if (!part) throw new Error('Tender template has no word/document.xml');

  const xml = strFromU8(part);
  const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => ({
    xml: match[0],
    text: wordParagraphText(match[0]),
  }));
  const text = paragraphs.map((paragraph) => paragraph.text).join(' ');

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

  const selectableOptions = [
    '(1)工程',
    '(2)財物',
    '(3)勞務',
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

  const missingCheckboxes = selectableOptions.filter((option) => {
    const paragraph = paragraphs.find((item) => item.text.includes(option));
    return !paragraph || !/[□☐]/.test(paragraph.xml);
  });
  if (missingCheckboxes.length) {
    throw new Error(`Tender writer checkbox glyph missing for: ${missingCheckboxes.join(' | ')}`);
  }

  const signature = buffer.subarray(0, 2).toString('ascii');
  if (signature !== 'PK') throw new Error('Tender template is not a valid ZIP-based DOCX.');

  console.log(`Tender template writer smoke OK: ${requiredAnchors.length} anchors and ${selectableOptions.length} checkbox options verified in 1150727 DOCX.`);
}

async function verifyServiceWriter() {
  const buffer = await readFile(SERVICE_TEMPLATE);
  const archive = unzipSync(new Uint8Array(buffer));
  const part = archive['content.xml'];
  if (!part) throw new Error('Service contract template has no content.xml');

  const mimetype = archive.mimetype ? strFromU8(archive.mimetype) : '';
  if (mimetype !== 'application/vnd.oasis.opendocument.text') {
    throw new Error(`Service contract template has unexpected ODT mimetype: ${mimetype || '(missing)'}`);
  }

  const xml = strFromU8(part);
  const blocks = [...xml.matchAll(/<text:(p|h)\b[\s\S]*?<\/text:\1>/g)].map((match) => ({
    xml: match[0],
    text: odtBlockText(match[0]),
  }));
  const text = blocks.map((block) => block.text).join(' ');

  const requiredAnchors = [
    '勞務採購契約範本',
    '招標機關(以下簡稱機關)',
    '廠商應給付之標的及工作事項',
    '契約價金結算方式',
    '第五條 契約價金之給付條件',
    '第七條 履約期限',
    '之期間內履行採購標的之供應',
    '第十一條 保證金',
    '第十二條 驗收',
    '驗收程序',
  ];
  const priceOptions = [
    '總包價法',
    '單價計算法',
    '服務成本加公費法',
    '按月計酬法',
    '按日計酬法',
    '按時計酬法',
  ];

  const missing = requiredAnchors.filter((anchor) => !text.includes(anchor));
  if (missing.length) {
    throw new Error(`Service writer anchors missing from official ODT: ${missing.join(' | ')}`);
  }

  const missingCheckboxes = priceOptions.filter((option) => {
    const block = blocks.find((item) => item.text.includes(option));
    return !block || !/[□☐]/.test(block.xml);
  });
  if (missingCheckboxes.length) {
    throw new Error(`Service writer checkbox glyph missing for: ${missingCheckboxes.join(' | ')}`);
  }

  console.log(`Service contract writer smoke OK: ${requiredAnchors.length} anchors and ${priceOptions.length} price options verified in 1141231 ODT.`);
}

await verifyTenderWriter();
await verifyServiceWriter();
