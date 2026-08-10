import { saveAs } from 'file-saver';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildCanonicalDocumentContext } from './mapping';
import {
  appendInlineAtAnchor,
  insertParagraphAfterAnchor,
  selectCheckboxOptionAtAnchor,
  type TemplateMutationResult,
} from './template-anchor-resolver';
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

function chooseProcurementMethod(value: string) {
  if (value.includes('公開取得')) return '依採購法第49條規定公開取得書面報價或企劃書';
  if (value.includes('限制性')) return '(3)限制性招標';
  if (value.includes('選擇性')) return '(2)選擇性招標';
  if (value.includes('公開招標')) return '(1)公開招標';
  return undefined;
}

function chooseAwardPrinciple(value: string) {
  if (value.includes('最有利')) return '(2)最有利標';
  if (value.includes('最高')) return '(3)最高標';
  if (value.includes('最低')) return '(1)最低標';
  return undefined;
}

function chooseAwardMethod(value: string) {
  if (value.includes('總價')) return '(2-1)總價決標';
  if (value.includes('分項')) return '(2-2)分項決標';
  if (value.includes('分組')) return '(2-3)分組決標';
  if (value.includes('數量')) return '(2-4)依數量決標';
  if (value.includes('單價')) return '(2-5)單價決標';
  return undefined;
}

function chooseCategory(category: ProcurementCase['category']) {
  if (category === 'construction') return '(1)工程';
  if (category === 'goods') return '(2)財物';
  if (category === 'service') return '(3)勞務';
  return undefined;
}

function record(
  result: TemplateMutationResult,
  label: string,
  report: TemplateWriteReport,
  missingAnchorWarning = true,
) {
  if (result.changed || (result.resolved && result.reason === 'unchanged')) {
    report.applied.push(label);
  } else if (missingAnchorWarning) {
    report.warnings.push(`${label}：未在官方範本唯一解析到安全 Anchor（匹配 ${result.matches} 個）。`);
  }
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
    const result = appendInlineAtAnchor(xml, 'word', { text: '本標案名稱：' }, context.title.value);
    xml = result.xml;
    record(result, '標案名稱', report);
  } else report.pending.push('標案名稱');

  if (context.category.ready) {
    const option = chooseCategory(procurementCase.category);
    if (option) {
      const result = selectCheckboxOptionAtAnchor(xml, 'word', option);
      xml = result.xml;
      record(result, '採購類型', report);
    }
  } else report.pending.push('採購類型');

  if (context.budget.ready) {
    const result = appendInlineAtAnchor(xml, 'word', { text: '本採購預算金額' }, context.budget.value);
    xml = result.xml;
    record(result, '預算金額', report);
  } else report.pending.push('預算金額');

  if (context.procurementMethod.ready) {
    const option = chooseProcurementMethod(context.procurementMethod.value);
    if (option) {
      const result = selectCheckboxOptionAtAnchor(xml, 'word', option);
      xml = result.xml;
      record(result, '招標方式', report);
    } else {
      report.pending.push(`招標方式（目前值「${context.procurementMethod.value}」需人工勾選）`);
    }
  } else report.pending.push('招標方式');

  if (context.awardPrinciple.ready) {
    const option = chooseAwardPrinciple(context.awardPrinciple.value);
    if (option) {
      const result = selectCheckboxOptionAtAnchor(xml, 'word', option);
      xml = result.xml;
      record(result, '決標原則', report);
    } else {
      report.pending.push(`決標原則（目前值「${context.awardPrinciple.value}」需人工勾選）`);
    }
  } else report.pending.push('決標原則');

  if (context.awardMethod.ready) {
    const option = chooseAwardMethod(context.awardMethod.value);
    if (option) {
      const result = selectCheckboxOptionAtAnchor(xml, 'word', option);
      xml = result.xml;
      record(result, '決標方式', report);
    } else {
      report.pending.push(`決標方式（目前值「${context.awardMethod.value}」需人工勾選）`);
    }
  } else report.pending.push('決標方式');

  if (context.bidBond.ready) {
    const result = appendInlineAtAnchor(xml, 'word', { text: '押標金金額' }, ` ${context.bidBond.value}`);
    xml = result.xml;
    record(result, '押標金', report);
  }

  if (context.performanceBond.ready) {
    const result = appendInlineAtAnchor(
      xml,
      'word',
      { text: '履約保證金金額' },
      ` ${context.performanceBond.value}`,
    );
    xml = result.xml;
    record(result, '履約保證金', report);
  }

  if (context.vendorQualification.ready) {
    const result = insertParagraphAfterAnchor(
      xml,
      'word',
      { text: '投標廠商之基本資格及應附具之證明文件如下' },
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
