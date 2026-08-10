import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

const templates = [
  {
    id: 'tender-instructions',
    version: '1150727',
    path: 'official-templates/tender-instructions/1150727/tender-instructions.docx',
    part: 'word/document.xml',
    blockPattern: /<w:p\b[\s\S]*?<\/w:p>/g,
    textOf: wordParagraphText,
    anchors: [
      { id: 'title', text: '本標案名稱：' },
      { id: 'budget', text: '本採購預算金額' },
      { id: 'bidBond', text: '押標金金額' },
      { id: 'performanceBond', text: '履約保證金金額' },
      { id: 'vendorQualification', text: '投標廠商之基本資格及應附具之證明文件如下' },
      { id: 'category.construction', text: '(1)工程', selectable: true },
      { id: 'category.goods', text: '(2)財物', selectable: true },
      { id: 'category.service', text: '(3)勞務', selectable: true },
      { id: 'procurementMethod.open', text: '(1)公開招標', selectable: true },
      { id: 'procurementMethod.selective', text: '(2)選擇性招標', selectable: true },
      { id: 'procurementMethod.restricted', text: '(3)限制性招標', selectable: true },
      { id: 'procurementMethod.quote', text: '公開取得書面報價或企劃書', selectable: true },
      { id: 'awardPrinciple.lowest', text: '(1)最低標', selectable: true },
      { id: 'awardPrinciple.best', text: '(2)最有利標', selectable: true },
      { id: 'awardPrinciple.highest', text: '(3)最高標', selectable: true },
      { id: 'awardMethod.total', text: '(2-1)總價決標', selectable: true },
      { id: 'awardMethod.item', text: '(2-2)分項決標', selectable: true },
      { id: 'awardMethod.group', text: '(2-3)分組決標', selectable: true },
      { id: 'awardMethod.quantity', text: '(2-4)依數量決標', selectable: true },
      { id: 'awardMethod.unit', text: '(2-5)單價決標', selectable: true },
    ],
  },
  {
    id: 'service-contract',
    version: '1141231',
    path: 'official-templates/service-contract/1141231/service-contract.odt',
    part: 'content.xml',
    blockPattern: /<text:(p|h)\b[\s\S]*?<\/text:\1>/g,
    textOf: odtBlockText,
    anchors: [
      { id: 'agency', text: '招標機關(以下簡稱機關)' },
      { id: 'scope', text: '廠商應給付之標的及工作事項' },
      { id: 'paymentTerms', text: '第五條 契約價金之給付條件' },
      { id: 'contractPeriod', text: '之期間內履行採購標的之供應' },
      { id: 'performanceBond', text: '第十一條 保證金' },
      { id: 'acceptanceMethod', text: '驗收程序(由機關擇需要者於招標時載明)' },
      { id: 'price.total', text: '總包價法', selectable: true },
      { id: 'price.unit', text: '單價計算法', selectable: true },
      { id: 'price.costPlus', text: '服務成本加公費法', selectable: true },
      { id: 'price.monthly', text: '按月計酬法', selectable: true },
      { id: 'price.daily', text: '按日計酬法', selectable: true },
      { id: 'price.hourly', text: '按時計酬法', selectable: true },
    ],
  },
];

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

async function auditTemplate(template) {
  const buffer = await readFile(template.path);
  const archive = unzipSync(new Uint8Array(buffer));
  const part = archive[template.part];
  if (!part) throw new Error(`${template.id}@${template.version}: missing ${template.part}`);

  const xml = strFromU8(part);
  const blocks = [...xml.matchAll(template.blockPattern)].map((match) => ({
    xml: match[0],
    text: template.textOf(match[0]),
  }));

  const problems = [];
  for (const anchor of template.anchors) {
    const matches = blocks.filter((block) => block.text.includes(anchor.text));
    if (matches.length !== 1) {
      problems.push(`${anchor.id}: expected 1 match for "${anchor.text}", got ${matches.length}`);
      continue;
    }
    if (anchor.selectable && !/[□☐■☒]/.test(matches[0].xml)) {
      problems.push(`${anchor.id}: anchor resolved but checkbox glyph is missing`);
    }
  }

  if (problems.length) {
    throw new Error(
      `${template.id}@${template.version} anchor audit failed:\n- ${problems.join('\n- ')}`,
    );
  }

  console.log(
    `${template.id}@${template.version}: ${template.anchors.length} writer anchors uniquely resolved.`,
  );
}

for (const template of templates) {
  await auditTemplate(template);
}

console.log('Official template anchor audit OK. Writers may safely use the current deterministic anchors.');
