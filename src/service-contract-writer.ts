import { saveAs } from 'file-saver';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildCanonicalDocumentContext } from './mapping';
import type { ProcurementCase } from './types';

const SERVICE_TEMPLATE_VERSION = '1141231';
const SERVICE_TEMPLATE_URL = new URL(
  '../official-templates/service-contract/1141231/service-contract.odt',
  import.meta.url,
).href;

export interface ServiceContractWriteReport {
  templateId: 'service-contract';
  templateVersion: string;
  applied: string[];
  pending: string[];
  warnings: string[];
}

export interface ServiceContractWriterOptions {
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

function blockText(blockXml: string) {
  const normalized = blockXml
    .replace(/<text:s\b[^>]*text:c="(\d+)"[^>]*\/>/g, (_match, count) => ' '.repeat(Number(count)))
    .replace(/<text:s\b[^>]*\/>/g, ' ')
    .replace(/<text:tab\b[^>]*\/>/g, '\t')
    .replace(/<text:line-break\b[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlText(normalized).replace(/\s+/g, ' ').trim();
}

function mutateFirstBlock(
  contentXml: string,
  matcher: (text: string) => boolean,
  mutate: (blockXml: string, text: string, tag: string) => string,
) {
  let changed = false;
  const xml = contentXml.replace(/<text:(p|h)\b[\s\S]*?<\/text:\1>/g, (blockXml, tag: string) => {
    if (changed) return blockXml;
    const text = blockText(blockXml);
    if (!matcher(text)) return blockXml;
    const next = mutate(blockXml, text, tag);
    changed = next !== blockXml;
    return next;
  });
  return { xml, changed };
}

function appendInline(contentXml: string, anchor: string, value: string) {
  if (!value.trim()) return { xml: contentXml, changed: false };
  return mutateFirstBlock(
    contentXml,
    (text) => text.includes(anchor),
    (blockXml, _text, tag) => blockXml.replace(
      new RegExp(`</text:${tag}>$`),
      `<text:span>${escapeXmlText(value)}</text:span></text:${tag}>`,
    ),
  );
}

function insertParagraphAfter(contentXml: string, anchor: string, value: string) {
  if (!value.trim()) return { xml: contentXml, changed: false };
  return mutateFirstBlock(
    contentXml,
    (text) => text.includes(anchor),
    (blockXml) => `${blockXml}<text:p>${escapeXmlText(value)}</text:p>`,
  );
}

function replaceVisibleLiteral(contentXml: string, anchor: string, literal: string, replacement: string) {
  if (!replacement.trim()) return { xml: contentXml, changed: false };
  return mutateFirstBlock(
    contentXml,
    (text) => text.includes(anchor),
    (blockXml) => {
      const escapedLiteral = escapeXmlText(literal);
      if (blockXml.includes(escapedLiteral)) return blockXml.replace(escapedLiteral, escapeXmlText(replacement));
      if (blockXml.includes(literal)) return blockXml.replace(literal, escapeXmlText(replacement));
      return blockXml;
    },
  );
}

function selectOption(contentXml: string, optionText: string) {
  return mutateFirstBlock(
    contentXml,
    (text) => text.includes(optionText),
    (blockXml) => {
      if (/[■☒]/.test(blockXml)) return blockXml;
      const next = blockXml.replace(/[□☐]/, '■');
      return next;
    },
  );
}

function replaceBlockText(contentXml: string, anchor: string, value: string) {
  return mutateFirstBlock(
    contentXml,
    (text) => text.includes(anchor),
    (blockXml, _text, tag) => {
      const open = blockXml.match(new RegExp(`^<text:${tag}\\b[^>]*>`))?.[0];
      if (!open) return blockXml;
      return `${open}${escapeXmlText(value)}</text:${tag}>`;
    },
  );
}

function chooseContractPriceMethod(value: string) {
  if (value.includes('服務成本加公費')) return '服務成本加公費法';
  if (value.includes('按月')) return '按月計酬法';
  if (value.includes('按日')) return '按日計酬法';
  if (value.includes('按時')) return '按時計酬法';
  if (value.includes('單價')) return '單價計算法';
  if (value.includes('總包') || value.includes('總價')) return '總包價法';
  return undefined;
}

function rocDate(value?: string) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return `${year - 1911} 年 ${month} 月 ${day} 日`;
}

function record(result: { changed: boolean }, label: string, report: ServiceContractWriteReport) {
  if (result.changed) report.applied.push(label);
  else report.warnings.push(`${label}：未在官方 ODT 找到可安全寫入的 Anchor。`);
}

function buildServiceScope(procurementCase: ProcurementCase) {
  const parts: string[] = [];
  if (procurementCase.description.trim()) parts.push(procurementCase.description.trim());
  if (procurementCase.deliverables.length) {
    parts.push(`主要交付成果：${procurementCase.deliverables.join('；')}`);
  }
  return parts.join('；');
}

export async function exportServiceContractDraft(
  procurementCase: ProcurementCase,
  options: ServiceContractWriterOptions = {},
): Promise<ServiceContractWriteReport> {
  if (procurementCase.category !== 'service') {
    throw new Error('勞務採購契約 Writer 只適用於採購類型為「勞務」的案件。');
  }

  const context = buildCanonicalDocumentContext(procurementCase);
  const report: ServiceContractWriteReport = {
    templateId: 'service-contract',
    templateVersion: SERVICE_TEMPLATE_VERSION,
    applied: [],
    pending: [],
    warnings: [],
  };

  const response = await fetch(SERVICE_TEMPLATE_URL);
  if (!response.ok) throw new Error(`無法載入工程會勞務採購契約官方 ODT：HTTP ${response.status}`);

  const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const contentPart = archive['content.xml'];
  if (!contentPart) throw new Error('官方 ODT 缺少 content.xml，已停止產製。');

  let xml = strFromU8(contentPart);

  if (context.agency.ready) {
    const result = replaceVisibleLiteral(
      xml,
      '招標機關(以下簡稱機關)',
      '招標機關',
      context.agency.value,
    );
    xml = result.xml;
    record(result, '招標機關', report);
  } else report.pending.push('招標機關');

  const scope = buildServiceScope(procurementCase);
  if (scope) {
    const result = appendInline(xml, '廠商應給付之標的及工作事項', ` ${scope}`);
    xml = result.xml;
    record(result, '履約標的及工作事項', report);
  } else report.pending.push('履約標的及工作事項');

  if (context.contractPriceMethod.ready) {
    const option = chooseContractPriceMethod(context.contractPriceMethod.value);
    if (option) {
      const result = selectOption(xml, option);
      xml = result.xml;
      record(result, '契約價金結算方式', report);
    } else {
      report.pending.push(`契約價金結算方式（目前值「${context.contractPriceMethod.value}」需人工勾選）`);
    }
  } else report.pending.push('契約價金結算方式');

  if (context.paymentTerms.ready) {
    const result = insertParagraphAfter(
      xml,
      '第五條 契約價金之給付條件',
      `【機關填列】付款條件：${context.paymentTerms.value}`,
    );
    xml = result.xml;
    record(result, '付款條件', report);
  } else report.pending.push('付款條件');

  if (procurementCase.contractStart && procurementCase.contractEnd) {
    const periodLine = `■廠商應於 ${rocDate(procurementCase.contractStart)}至 ${rocDate(procurementCase.contractEnd)}之期間內履行採購標的之供應。`;
    const result = replaceBlockText(xml, '之期間內履行採購標的之供應', periodLine);
    xml = result.xml;
    record(result, '履約期間', report);
  } else report.pending.push('履約期間');

  if (context.performanceBond.ready) {
    const result = insertParagraphAfter(
      xml,
      '第十一條 保證金',
      `【機關填列】履約保證金：${context.performanceBond.value}`,
    );
    xml = result.xml;
    record(result, '履約保證金', report);
  }

  if (context.acceptanceMethod.ready) {
    const result = insertParagraphAfter(
      xml,
      '驗收程序(由機關擇需要者於招標時載明)',
      `【機關填列】驗收方式：${context.acceptanceMethod.value}`,
    );
    xml = result.xml;
    record(result, '驗收方式', report);
  } else report.pending.push('驗收方式');

  archive['content.xml'] = strToU8(xml);

  const outputEntries: Parameters<typeof zipSync>[0] = {};
  if (archive.mimetype) outputEntries.mimetype = [archive.mimetype, { level: 0 }];
  for (const [name, data] of Object.entries(archive)) {
    if (name === 'mimetype') continue;
    outputEntries[name] = data;
  }

  const output = zipSync(outputEntries, { level: 6 });
  const blob = new Blob([output], { type: 'application/vnd.oasis.opendocument.text' });
  const safeName = (procurementCase.title || '採購案件').replace(/[\\/:*?"<>|]/g, '_');
  const filename = `${safeName}_勞務採購契約_工程會${SERVICE_TEMPLATE_VERSION}_初稿.odt`;
  options.onGenerated?.(blob, filename);
  if (options.download !== false) saveAs(blob, filename);

  if (report.pending.length) {
    report.warnings.push('本檔為初稿；未能 deterministic 對應的條款與選項仍須人工確認。');
  }
  report.warnings.push('工程會 1141231 的 Word 原檔為舊式 .doc；本 Writer 使用同版本官方 ODT，以保留可驗證且可編輯的官方版型。');

  return report;
}
