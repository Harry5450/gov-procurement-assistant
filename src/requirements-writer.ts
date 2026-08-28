import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import { formatBondSetting, validateCanonicalConsistency } from './mapping';
import type { ProcurementCase } from './types';

export interface RequirementsDraftReport {
  documentType: 'service-requirements';
  applied: string[];
  pending: string[];
  warnings: string[];
}

export interface RequirementsWriterOptions {
  download?: boolean;
  onGenerated?: (blob: Blob, filename: string) => void;
}

export interface RequirementsSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  ready: boolean;
}

export interface ServiceRequirementsModel {
  title: string;
  metadata: Array<[string, string]>;
  sections: RequirementsSection[];
  pending: string[];
  warnings: string[];
}

function safeText(value?: string) {
  return value?.trim() ?? '';
}

function money(value?: number) {
  if (!value || value <= 0) return '';
  return `新臺幣 ${Math.round(value).toLocaleString('zh-TW')} 元`;
}

function rocDate(value?: string) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return `民國 ${year - 1911} 年 ${month} 月 ${day} 日`;
}

function period(start?: string, end?: string) {
  if (!start || !end) return '';
  return `${rocDate(start)}至${rocDate(end)}`;
}

function present(label: string, value: string, pending: string[]) {
  if (value) return value;
  pending.push(label);
  return '【待機關填列】';
}

function outwardConsistencyWarnings(procurementCase: ProcurementCase) {
  return validateCanonicalConsistency(procurementCase).filter((warning) =>
    !warning.includes('底價／預估底價')
    && !warning.includes('標價項目僅部分填有')
    && !warning.includes('標價清單內部預估合計'),
  );
}

export function buildServiceRequirementsModel(procurementCase: ProcurementCase): ServiceRequirementsModel {
  if (procurementCase.category !== 'service') {
    throw new Error('需求規格書 Writer 目前只適用於採購類型為「勞務」的案件。');
  }

  const pending: string[] = [];
  const warnings = outwardConsistencyWarnings(procurementCase);
  const agency = present('機關名稱', safeText(procurementCase.agency), pending);
  const title = present('標案名稱', safeText(procurementCase.title), pending);
  const budget = present('預算金額', money(procurementCase.budget), pending);
  const contractPeriod = present('履約期間', period(procurementCase.contractStart, procurementCase.contractEnd), pending);
  const description = present('採購需求／履約標的', safeText(procurementCase.description), pending);
  const paymentTerms = present('付款條件', safeText(procurementCase.paymentTerms), pending);
  const acceptanceMethod = present('驗收方式', safeText(procurementCase.acceptanceMethod), pending);
  const vendorQualification = present('廠商資格', safeText(procurementCase.vendorQualification), pending);
  const deliverables = procurementCase.deliverables.map((item) => item.trim()).filter(Boolean);
  if (!deliverables.length) pending.push('主要交付成果');

  const procurementMethod = safeText(procurementCase.procurementMethod) || '【待機關確認】';
  const awardPrinciple = safeText(procurementCase.awardPrinciple) || '【待機關確認】';
  const awardMethod = safeText(procurementCase.awardMethod) || '【待機關確認】';
  const contractPriceMethod = safeText(procurementCase.contractPriceMethod) || '【待機關確認】';
  const performanceBond = formatBondSetting(procurementCase, 'performanceBond') || '【待機關確認】';

  const sections: RequirementsSection[] = [
    {
      id: 'purpose',
      title: '一、採購目的與需求概要',
      paragraphs: [description],
      ready: Boolean(safeText(procurementCase.description)),
    },
    {
      id: 'scope',
      title: '二、履約標的與工作範圍',
      paragraphs: [
        description,
        '廠商應依本需求規格書、招標文件及契約約定完成履約；如各文件內容需進一步細化，應於招標前由機關完成確認。',
      ],
      bullets: deliverables.length ? deliverables : ['【待機關填列主要工作項目／交付成果】'],
      ready: Boolean(safeText(procurementCase.description) && deliverables.length),
    },
    {
      id: 'period',
      title: '三、履約期間',
      paragraphs: [`履約期間：${contractPeriod}。`],
      ready: Boolean(procurementCase.contractStart && procurementCase.contractEnd),
    },
    {
      id: 'deliverables',
      title: '四、主要交付成果',
      paragraphs: ['廠商至少應完成下列交付成果；實際份數、格式、繳交時點及修正次數由機關於招標前確認。'],
      bullets: deliverables.length ? deliverables : ['【待機關填列主要交付成果】'],
      ready: Boolean(deliverables.length),
    },
    {
      id: 'acceptance',
      title: '五、驗收方式與判定基礎',
      paragraphs: [
        `驗收方式：${acceptanceMethod}。`,
        '驗收應以契約、需求規格書及經機關確認之交付成果為判定基礎；具體抽驗方式、合格標準、改善期限及文件份數仍應由機關於招標前明定。',
      ],
      ready: Boolean(safeText(procurementCase.acceptanceMethod)),
    },
    {
      id: 'payment',
      title: '六、付款條件',
      paragraphs: [`付款條件：${paymentTerms}。`],
      ready: Boolean(safeText(procurementCase.paymentTerms)),
    },
    {
      id: 'qualification',
      title: '七、廠商資格與履約能力要求',
      paragraphs: [vendorQualification],
      ready: Boolean(safeText(procurementCase.vendorQualification)),
    },
    {
      id: 'contract-settings',
      title: '八、契約及招標設定參照',
      paragraphs: [
        `招標方式：${procurementMethod}`,
        `決標原則：${awardPrinciple}`,
        `決標方式：${awardMethod}`,
        `契約價金計算方式：${contractPriceMethod}`,
        `履約保證金：${performanceBond}`,
      ],
      ready: Boolean(
        safeText(procurementCase.procurementMethod)
        && safeText(procurementCase.awardPrinciple)
        && safeText(procurementCase.awardMethod)
        && safeText(procurementCase.contractPriceMethod),
      ),
    },
  ];

  return {
    title: `${title}－勞務採購需求規格書（工作說明書）`,
    metadata: [
      ['招標機關', agency],
      ['標案名稱', title],
      ['採購類型', '勞務採購'],
      ['預算金額', budget],
      ['履約期間', contractPeriod],
    ],
    sections,
    pending: [...new Set(pending)],
    warnings,
  };
}

function sectionParagraphs(section: RequirementsSection) {
  const output: Paragraph[] = [
    new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }),
    ...section.paragraphs.map((text) => new Paragraph(text)),
  ];
  if (section.bullets?.length) {
    output.push(...section.bullets.map((text) => new Paragraph({ text, bullet: { level: 0 } })));
  }
  return output;
}

export async function exportServiceRequirementsDraft(
  procurementCase: ProcurementCase,
  options: RequirementsWriterOptions = {},
): Promise<RequirementsDraftReport> {
  const model = buildServiceRequirementsModel(procurementCase);
  const applied = model.sections.filter((section) => section.ready).map((section) => section.title.replace(/^[一二三四五六七八九十]+、/, ''));

  const children: Paragraph[] = [
    new Paragraph({ text: model.title, heading: HeadingLevel.TITLE }),
    new Paragraph('本文件由 GovProcure Assistant 依案件既有欄位於本機 deterministic 產生，屬機關自訂初稿，並非工程會固定格式官方範本。'),
    new Paragraph('系統不會自動替承辦人判斷法定招標方式、決標方式、資格條件或其他應由機關依法審認之事項。'),
    new Paragraph({ text: '案件基本資料', heading: HeadingLevel.HEADING_1 }),
    ...model.metadata.map(([label, value]) => new Paragraph({
      children: [new TextRun({ text: `${label}：`, bold: true }), new TextRun(value)],
    })),
    ...model.sections.flatMap(sectionParagraphs),
    new Paragraph({ text: '九、待人工確認事項', heading: HeadingLevel.HEADING_1 }),
    ...(model.pending.length
      ? model.pending.map((item) => new Paragraph({ text: item, bullet: { level: 0 } }))
      : [new Paragraph('目前核心欄位均已填寫；仍應依個案確認技術標準、數量、頻率、服務水準及其他專屬要求。')]),
  ];

  if (model.warnings.length) {
    children.push(
      new Paragraph({ text: '十、跨文件一致性警示', heading: HeadingLevel.HEADING_1 }),
      ...model.warnings.map((item) => new Paragraph({ text: item, bullet: { level: 0 } })),
    );
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const safeName = (procurementCase.title || '採購案件').replace(/[\\/:*?"<>|]/g, '_');
  const filename = `${safeName}_勞務採購需求規格書_初稿.docx`;
  options.onGenerated?.(blob, filename);
  if (options.download !== false) saveAs(blob, filename);

  return {
    documentType: 'service-requirements',
    applied,
    pending: model.pending,
    warnings: model.warnings,
  };
}
