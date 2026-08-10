import { saveAs } from 'file-saver';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildCanonicalDocumentContext } from './mapping';
import type { ProcurementCase } from './types';

const TENDER_TEMPLATE_VERSION = '1150727';
const TENDER_TEMPLATE_URL = new URL(
  '../official-templates/tender-instructions/1150727/tender-instructions.docx',
  import.meta.url,
).href;

export interface TemplateWriteReport {
  templateId: 'tender-instructions';
  templateVersion: string;
  applied: string[];
  pending: string[];
  warnings: string[];
}

export interface TemplateWriterOptions {
  download?: boolean;
  onGenerated?: (blob: Blob, filename: string) => void;
}

function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function paragraphText(paragraphXml: string) {
  return [...paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXmlText(match[1]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function mutateFirstParagraph(
  documentXml: string,
  matcher: (text: string) => boolean,
  mutate: (paragraphXml: string, text: string) => string,
) {
  let changed = false;
  const xml = documentXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    if (changed) return paragraphXml;
    const text = paragraphText(paragraphXml);
    if (!matcher(text)) return paragraphXml;
    const next = mutate(paragraphXml, text);
    if (next !== paragraphXml) changed = true;
    return next;
  });
  return { xml, changed };
}

function appendInline(documentXml: string, anchor: string, value: string) {
  if (!value.trim()) return { xml: documentXml, changed: false };
  return mutateFirstParagraph(
    documentXml,
    (text) => text.includes(anchor),
    (paragraphXml) => paragraphXml.replace(
      /<\/w:p>$/,
      `<w:r><w:t xml:space="preserve">${escapeXmlText(value)}</w:t></w:r></w:p>`,
    ),
  );
}

function insertParagraphAfter(documentXml: string, anchor: string, value: string) {
  if (!value.trim()) return { xml: documentXml, changed: false };
  return mutateFirstParagraph(
    documentXml,
    (text) => text.includes(anchor),
    (paragraphXml) => {
      const pPr = paragraphXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
      const inserted = `<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXmlText(value)}</w:t></w:r></w:p>`;
      return `${paragraphXml}${inserted}`;
    },
  );
}

function selectOption(documentXml: string, optionText: string) {
  return mutateFirstParagraph(
    documentXml,
    (text) => text.includes(optionText),
    (paragraphXml) => {
      if (/[■☒]/.test(paragraphXml)) return paragraphXml;
      if (!/[□☐]/.test(paragraphXml)) return paragraphXml;
      return paragraphXml.replace(/[□☐]/, '■');
    },
  );
}

function normalizeChoice(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '');
}

function chooseProcurementMethod(value: string) {
  const normalized = normalizeChoice(value);
  if (normalized.includes('公開取得')) return '依採購法第49條規定公開取得書面報價或企劃書';
  if (normalized.includes('限制性')) return '(3)限制性招標';
  if (normalized.includes('選擇性')) return '(2)選擇性招標';
  if (normalized.includes('公開招標')) return '(1)公開招標';
  return undefined;
}

function chooseAwardPrinciple(value: string) {
  const normalized = normalizeChoice(value);
  if (normalized.includes('最有利')) return '(2)最有利標';
  if (normalized.includes('最高')) return '(3)最高標';
  if (normalized.includes('最低')) return '(1)最低標';
  return undefined;
}

function chooseAwardMethod(value: string) {
  const normalized = normalizeChoice(value);
  if (normalized.includes('總價')) return '(2-1)總價決標';
  if (normalized.includes('分項')) return '(2-2)分項決標';
  if (normalized.includes('分組')) return '(2-3)分組決標';
  if (normalized.includes('數量')) return '(2-4)依數量決標';
  if (normalized.includes('單價')) return '(2-5)單價決標';
  return undefined;
}

function chooseCategory(category: ProcurementCase['category']) {
  if (category === 'construction') return '(1)工程';
  if (category === 'goods') return '(2)財物';
  if (category === 'service') return '(3)勞務';
  return undefined;
}

function record(
  result: { changed: boolean },
  label: string,
  report: TemplateWriteReport,
  missingAnchorWarning = true,
) {
  if (result.changed) report.applied.push(label);
  else if (missingAnchorWarning) report.warnings.push(`${label}：未在官方範本找到可安全寫入的 Anchor 或可勾選符號。`);
}

export async function exportTenderInstructionsDraft(
  procurementCase: ProcurementCase,
  options: TemplateWriterOptions = {},
): Promise<TemplateWriteReport> {
  const context = buildCanonicalDocumentContext(procurementCase);
  const report: TemplateWriteReport = {
    templateId: 'tender-instructions',
    templateVersion: TENDER_TEMPLATE_VERSION,
    applied: [],
    pending: [],
    warnings: [],
  };

  const response = await fetch(TENDER_TEMPLATE_URL);
  if (!response.ok) throw new Error(`無法載入工程會投標須知官方範本：HTTP ${response.status}`);

  const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const documentPart = archive['word/document.xml'];
  if (!documentPart) throw new Error('官方 DOCX 缺少 word/document.xml，已停止產製。');

  let xml = strFromU8(documentPart);

  if (context.title.ready) {
    const result = appendInline(xml, '本標案名稱：', context.title.value);
    xml = result.xml;
    record(result, '標案名稱', report);
  } else report.pending.push('標案名稱');

  if (context.category.ready) {
    const option = chooseCategory(procurementCase.category);
    if (option) {
      const result = selectOption(xml, option);
      xml = result.xml;
      record(result, '採購類型', report);
    }
  } else report.pending.push('採購類型');

  if (context.budget.ready) {
    const result = appendInline(xml, '本採購預算金額', context.budget.value);
    xml = result.xml;
    record(result, '預算金額', report);
  } else report.pending.push('預算金額');

  if (context.procurementMethod.ready) {
    const option = chooseProcurementMethod(context.procurementMethod.value);
    if (option) {
      const result = selectOption(xml, option);
      xml = result.xml;
      record(result, '招標方式', report);
    } else {
      report.pending.push(`招標方式（目前值「${context.procurementMethod.value}」需人工勾選）`);
    }
  } else report.pending.push('招標方式');

  if (context.awardPrinciple.ready) {
    const option = chooseAwardPrinciple(context.awardPrinciple.value);
    if (option) {
      const result = selectOption(xml, option);
      xml = result.xml;
      record(result, '決標原則', report);
    } else {
      report.pending.push(`決標原則（目前值「${context.awardPrinciple.value}」需人工勾選）`);
    }
  } else report.pending.push('決標原則');

  if (context.awardMethod.ready) {
    const option = chooseAwardMethod(context.awardMethod.value);
    if (option) {
      const result = selectOption(xml, option);
      xml = result.xml;
      record(result, '決標方式', report);
    } else {
      report.pending.push(`決標方式（目前值「${context.awardMethod.value}」需人工勾選）`);
    }
  } else report.pending.push('決標方式');

  if (context.bidBond.ready) {
    const result = appendInline(xml, '押標金金額', ` ${context.bidBond.value}`);
    xml = result.xml;
    record(result, '押標金', report);
  }

  if (context.performanceBond.ready) {
    const result = appendInline(xml, '履約保證金金額', ` ${context.performanceBond.value}`);
    xml = result.xml;
    record(result, '履約保證金', report);
  }

  if (context.vendorQualification.ready) {
    const result = insertParagraphAfter(
      xml,
      '投標廠商之基本資格及應附具之證明文件如下',
      `【機關填列】${context.vendorQualification.value}`,
    );
    xml = result.xml;
    record(result, '廠商資格', report);
  } else report.pending.push('廠商資格');

  archive['word/document.xml'] = strToU8(xml);
  const output = zipSync(archive, { level: 6 });
  const blob = new Blob([output], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const safeName = (procurementCase.title || '採購案件').replace(/[\\/:*?"<>|]/g, '_');
  const filename = `${safeName}_投標須知_工程會${TENDER_TEMPLATE_VERSION}_初稿.docx`;
  options.onGenerated?.(blob, filename);
  if (options.download !== false) saveAs(blob, filename);

  if (report.pending.length) {
    report.warnings.push('本檔為初稿；未能 deterministic 對應的欄位仍保留官方原始選項，須人工確認。');
  }
  return report;
}
