import type { ProcurementCase, RuleResult } from './types';

const COMMON_DOCUMENTS = [
  '招標投標及契約文件',
  '投標須知',
  '投標廠商聲明書',
  '標價清單',
];

export function evaluateCase(procurementCase: ProcurementCase): RuleResult {
  const requiredDocuments = [...COMMON_DOCUMENTS];
  const optionalDocuments: string[] = [];
  const confirmations: string[] = [];
  const warnings: string[] = [];

  switch (procurementCase.category) {
    case 'service':
      requiredDocuments.push('勞務採購契約', '需求規格書／工作說明書');
      optionalDocuments.push('服務建議書格式', '評選須知及評選配分表');
      break;
    case 'goods':
      requiredDocuments.push('財物採購契約', '採購規格書');
      optionalDocuments.push('型錄／規格對照表');
      break;
    case 'construction':
      requiredDocuments.push('工程採購契約', '工程規範及數量清單');
      warnings.push('工程採購規則較複雜，MVP 僅提供文件清單提示，應由採購／工程專業人員確認。');
      break;
    default:
      warnings.push('尚未確認採購類型，無法完整決定文件組合。');
  }

  if (!procurementCase.vendorQualification.trim()) confirmations.push('廠商資格尚未確認');
  if (!procurementCase.acceptanceMethod.trim()) confirmations.push('驗收方式尚未確認');
  if (!procurementCase.paymentTerms.trim()) confirmations.push('付款條件尚未確認');
  if (!procurementCase.contractStart || !procurementCase.contractEnd) confirmations.push('履約期間尚未完整設定');
  if (procurementCase.budget <= 0) warnings.push('預算金額未設定或不正確');
  if (procurementCase.reservePrice !== undefined) warnings.push('偵測到底價／預估底價欄位：此資料屬 RESTRICTED，不得送往外部 LLM。');

  return { requiredDocuments, optionalDocuments, confirmations, warnings };
}

export function completenessScore(procurementCase: ProcurementCase): number {
  const checks = [
    procurementCase.title.trim().length > 0,
    procurementCase.agency.trim().length > 0,
    procurementCase.category !== 'unknown',
    procurementCase.budget > 0,
    procurementCase.description.trim().length > 0,
    Boolean(procurementCase.contractStart),
    Boolean(procurementCase.contractEnd),
    procurementCase.paymentTerms.trim().length > 0,
    procurementCase.acceptanceMethod.trim().length > 0,
    procurementCase.vendorQualification.trim().length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
