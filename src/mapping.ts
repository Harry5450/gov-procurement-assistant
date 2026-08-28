import type { ProcurementCase, ProcurementCategory } from './types';

export type CanonicalFieldKey =
  | 'agency'
  | 'title'
  | 'category'
  | 'budget'
  | 'description'
  | 'contractPeriod'
  | 'paymentTerms'
  | 'acceptanceMethod'
  | 'deliverables'
  | 'vendorQualification'
  | 'procurementMethod'
  | 'awardPrinciple'
  | 'awardMethod'
  | 'bidBond'
  | 'performanceBond'
  | 'contractPriceMethod';

export interface CanonicalFieldValue {
  key: CanonicalFieldKey;
  label: string;
  value: string;
  ready: boolean;
  source: keyof ProcurementCase | 'derived';
}

export interface TemplateFieldSpec {
  key: CanonicalFieldKey;
  targetLabel: string;
  anchor: string;
  required: boolean;
  note?: string;
}

export interface TemplateMappingSpec {
  templateId: 'tender-instructions' | 'service-contract' | 'goods-contract' | 'construction-contract';
  templateName: string;
  categories: Array<ProcurementCategory | 'common'>;
  fields: TemplateFieldSpec[];
}

export interface TemplateMappingRow extends TemplateFieldSpec {
  canonicalLabel: string;
  value: string;
  ready: boolean;
}

export interface TemplateMappingPreview {
  templateId: TemplateMappingSpec['templateId'];
  templateName: string;
  rows: TemplateMappingRow[];
  requiredCount: number;
  readyRequiredCount: number;
  coverage: number;
}

const categoryLabels: Record<ProcurementCategory, string> = {
  unknown: '',
  service: '勞務',
  goods: '財物',
  construction: '工程',
};

function money(value?: number) {
  if (!value || value <= 0) return '';
  return `新臺幣 ${Math.round(value).toLocaleString('zh-TW')} 元`;
}

function period(start?: string, end?: string) {
  if (!start && !end) return '';
  if (!start || !end) return `${start || '未填'} ～ ${end || '未填'}`;
  return `${start} ～ ${end}`;
}

function list(values?: string[]) {
  return values?.map((value) => value.trim()).filter(Boolean).join('；') ?? '';
}

function workflowFieldText(procurementCase: ProcurementCase, fieldId: string): string {
  const value = procurementCase.fields?.[fieldId]?.value;
  return typeof value === 'string' ? value.trim() : '';
}

/** Convert the legacy machine values used by the first MVP into wording that
 * can safely appear in previews and generated documents. */
export function formatBondSetting(
  procurementCase: ProcurementCase,
  kind: 'bidBond' | 'performanceBond',
): string {
  const raw = procurementCase[kind]?.trim() ?? '';
  if (!raw) return '';
  const normalized = raw.toLowerCase();
  const isNone = normalized === 'none'
    || normalized === 'bid-bond-none'
    || normalized === 'performance-bond-none';
  if (isNone) return '不收取';
  const isRequired = normalized === 'required'
    || normalized === 'bid-bond-required'
    || normalized === 'performance-bond-required';
  if (!isRequired) return raw;
  const detailId = kind === 'bidBond' ? 'decisions.bidBondDetails' : 'decisions.performanceBondDetails';
  const details = workflowFieldText(procurementCase, detailId);
  return details ? `收取；${details}` : '收取（詳細條件待填）';
}

export function buildCanonicalDocumentContext(procurementCase: ProcurementCase): Record<CanonicalFieldKey, CanonicalFieldValue> {
  const values: CanonicalFieldValue[] = [
    { key: 'agency', label: '機關名稱', value: procurementCase.agency.trim(), ready: Boolean(procurementCase.agency.trim()), source: 'agency' },
    { key: 'title', label: '標案名稱', value: procurementCase.title.trim(), ready: Boolean(procurementCase.title.trim()), source: 'title' },
    { key: 'category', label: '採購類型', value: categoryLabels[procurementCase.category], ready: procurementCase.category !== 'unknown', source: 'category' },
    { key: 'budget', label: '預算金額', value: money(procurementCase.budget), ready: procurementCase.budget > 0, source: 'budget' },
    { key: 'description', label: '採購需求／履約標的', value: procurementCase.description.trim(), ready: Boolean(procurementCase.description.trim()), source: 'description' },
    { key: 'contractPeriod', label: '履約期間', value: period(procurementCase.contractStart, procurementCase.contractEnd), ready: Boolean(procurementCase.contractStart && procurementCase.contractEnd), source: 'derived' },
    { key: 'paymentTerms', label: '付款條件', value: procurementCase.paymentTerms.trim(), ready: Boolean(procurementCase.paymentTerms.trim()), source: 'paymentTerms' },
    { key: 'acceptanceMethod', label: '驗收方式', value: procurementCase.acceptanceMethod.trim(), ready: Boolean(procurementCase.acceptanceMethod.trim()), source: 'acceptanceMethod' },
    { key: 'deliverables', label: '主要交付成果', value: list(procurementCase.deliverables), ready: procurementCase.deliverables.length > 0, source: 'deliverables' },
    { key: 'vendorQualification', label: '廠商資格', value: procurementCase.vendorQualification.trim(), ready: Boolean(procurementCase.vendorQualification.trim()), source: 'vendorQualification' },
    { key: 'procurementMethod', label: '招標方式', value: procurementCase.procurementMethod?.trim() ?? '', ready: Boolean(procurementCase.procurementMethod?.trim()), source: 'procurementMethod' },
    { key: 'awardPrinciple', label: '決標原則', value: procurementCase.awardPrinciple?.trim() ?? '', ready: Boolean(procurementCase.awardPrinciple?.trim()), source: 'awardPrinciple' },
    { key: 'awardMethod', label: '決標方式', value: procurementCase.awardMethod?.trim() ?? '', ready: Boolean(procurementCase.awardMethod?.trim()), source: 'awardMethod' },
    { key: 'bidBond', label: '押標金', value: formatBondSetting(procurementCase, 'bidBond'), ready: Boolean(procurementCase.bidBond?.trim()), source: 'bidBond' },
    { key: 'performanceBond', label: '履約保證金', value: formatBondSetting(procurementCase, 'performanceBond'), ready: Boolean(procurementCase.performanceBond?.trim()), source: 'performanceBond' },
    { key: 'contractPriceMethod', label: '契約價金計算方式', value: procurementCase.contractPriceMethod?.trim() ?? '', ready: Boolean(procurementCase.contractPriceMethod?.trim()), source: 'contractPriceMethod' },
  ];

  return Object.fromEntries(values.map((item) => [item.key, item])) as Record<CanonicalFieldKey, CanonicalFieldValue>;
}

export const templateMappingRegistry: TemplateMappingSpec[] = [
  {
    templateId: 'tender-instructions',
    templateName: '投標須知範本',
    categories: ['common'],
    fields: [
      { key: 'title', targetLabel: '本標案名稱', anchor: '本標案名稱：', required: true },
      { key: 'category', targetLabel: '採購標的類型', anchor: '採購標的為：', required: true },
      { key: 'budget', targetLabel: '本採購預算金額', anchor: '本採購預算金額', required: true },
      { key: 'procurementMethod', targetLabel: '招標方式', anchor: '招標方式為：', required: true, note: '由承辦人選定；Mapping Engine 不自動判斷法定招標方式。' },
      { key: 'bidBond', targetLabel: '押標金', anchor: '押標金金額', required: false },
      { key: 'performanceBond', targetLabel: '履約保證金', anchor: '履約保證金金額', required: false },
      { key: 'awardPrinciple', targetLabel: '決標原則', anchor: '決標原則：', required: true },
      { key: 'awardMethod', targetLabel: '決標方式', anchor: '決標方式為：', required: true },
      { key: 'vendorQualification', targetLabel: '投標廠商基本資格', anchor: '投標廠商之基本資格及應附具之證明文件如下', required: true },
    ],
  },
  {
    templateId: 'service-contract',
    templateName: '勞務採購契約範本',
    categories: ['service'],
    fields: [
      { key: 'agency', targetLabel: '招標機關', anchor: '招標機關(以下簡稱機關)', required: true },
      { key: 'description', targetLabel: '履約標的及工作事項', anchor: '第二條 履約標的', required: true },
      { key: 'deliverables', targetLabel: '履約成果', anchor: '第二條 履約標的', required: true },
      { key: 'contractPriceMethod', targetLabel: '契約價金結算方式', anchor: '契約價金結算方式', required: true },
      { key: 'paymentTerms', targetLabel: '契約價金給付條件', anchor: '契約價金之給付', required: true },
      { key: 'contractPeriod', targetLabel: '履約期限', anchor: '履約期限', required: true },
      { key: 'acceptanceMethod', targetLabel: '驗收', anchor: '驗收', required: true },
      { key: 'performanceBond', targetLabel: '履約保證金', anchor: '履約保證金', required: false },
    ],
  },
  {
    templateId: 'goods-contract',
    templateName: '財物採購契約範本',
    categories: ['goods'],
    fields: [
      { key: 'agency', targetLabel: '招標機關', anchor: '招標機關', required: true },
      { key: 'description', targetLabel: '履約標的', anchor: '履約標的', required: true },
      { key: 'contractPeriod', targetLabel: '履約期限', anchor: '履約期限', required: true },
      { key: 'paymentTerms', targetLabel: '付款條件', anchor: '契約價金之給付', required: true },
      { key: 'acceptanceMethod', targetLabel: '驗收', anchor: '驗收', required: true },
      { key: 'performanceBond', targetLabel: '履約保證金', anchor: '履約保證金', required: false },
    ],
  },
  {
    templateId: 'construction-contract',
    templateName: '工程採購契約範本',
    categories: ['construction'],
    fields: [
      { key: 'agency', targetLabel: '招標機關', anchor: '招標機關', required: true },
      { key: 'description', targetLabel: '工程履約標的', anchor: '履約標的', required: true },
      { key: 'contractPeriod', targetLabel: '履約期限', anchor: '履約期限', required: true },
      { key: 'paymentTerms', targetLabel: '估驗／付款條件', anchor: '契約價金之給付', required: true },
      { key: 'acceptanceMethod', targetLabel: '驗收', anchor: '驗收', required: true },
      { key: 'performanceBond', targetLabel: '履約保證金', anchor: '履約保證金', required: false },
    ],
  },
];

export function getApplicableMappingSpecs(procurementCase: ProcurementCase) {
  return templateMappingRegistry.filter((mapping) =>
    mapping.categories.includes('common') || mapping.categories.includes(procurementCase.category),
  );
}

export function buildTemplateMappingPreview(procurementCase: ProcurementCase, mapping: TemplateMappingSpec): TemplateMappingPreview {
  const context = buildCanonicalDocumentContext(procurementCase);
  const rows = mapping.fields.map((spec) => ({
    ...spec,
    canonicalLabel: context[spec.key].label,
    value: context[spec.key].value,
    ready: context[spec.key].ready,
  }));
  const requiredRows = rows.filter((row) => row.required);
  const readyRequiredCount = requiredRows.filter((row) => row.ready).length;

  return {
    templateId: mapping.templateId,
    templateName: mapping.templateName,
    rows,
    requiredCount: requiredRows.length,
    readyRequiredCount,
    coverage: requiredRows.length ? Math.round((readyRequiredCount / requiredRows.length) * 100) : 100,
  };
}

export function buildAllTemplateMappingPreviews(procurementCase: ProcurementCase) {
  return getApplicableMappingSpecs(procurementCase).map((mapping) => buildTemplateMappingPreview(procurementCase, mapping));
}

export function validateCanonicalConsistency(procurementCase: ProcurementCase) {
  const issues: string[] = [];

  if (procurementCase.contractStart && procurementCase.contractEnd && procurementCase.contractStart > procurementCase.contractEnd) {
    issues.push('履約開始日期晚於履約結束日期。');
  }

  if (procurementCase.reservePrice !== undefined && procurementCase.budget > 0 && procurementCase.reservePrice > procurementCase.budget) {
    issues.push('底價／預估底價高於預算金額，請人工確認。');
  }

  if (procurementCase.category === 'service' && !procurementCase.deliverables.length) {
    issues.push('勞務案件尚未設定主要交付成果，契約與需求規格書容易產生不一致。');
  }

  const pricingItems = (procurementCase.pricingItems ?? []).filter((item) => item.description.trim());
  const estimatedItems = pricingItems.filter(
    (item) => item.quantity !== undefined && item.quantity > 0 && item.estimatedUnitPrice !== undefined,
  );

  if (pricingItems.length && estimatedItems.length > 0 && estimatedItems.length < pricingItems.length) {
    issues.push('標價項目僅部分填有數量與內部預估單價，暫時無法完成預算總額一致性檢查。');
  }

  if (pricingItems.length > 0 && estimatedItems.length === pricingItems.length && procurementCase.budget > 0) {
    const estimateTotal = estimatedItems.reduce(
      (sum, item) => sum + (item.quantity ?? 0) * (item.estimatedUnitPrice ?? 0),
      0,
    );
    const difference = procurementCase.budget - estimateTotal;
    if (Math.abs(difference) >= 1) {
      issues.push(
        difference > 0
          ? `標價清單內部預估合計較預算少新臺幣 ${Math.round(difference).toLocaleString('zh-TW')} 元。`
          : `標價清單內部預估合計超過預算新臺幣 ${Math.round(Math.abs(difference)).toLocaleString('zh-TW')} 元。`,
      );
    }
  }

  return issues;
}
