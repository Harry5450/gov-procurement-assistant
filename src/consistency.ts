import { buildAllTemplateMappingPreviews } from './mapping';
import { buildProcurementGuidance, isGuidanceOptionValue } from './procurement-guidance';
import type { PricingItem, ProcurementCase } from './types';

export type ConsistencyStatus = 'pass' | 'warning' | 'blocker';
export type ConsistencyDocumentId =
  | 'tender-instructions'
  | 'service-contract'
  | 'service-requirements'
  | 'price-schedule';

export interface ConsistencyCheck {
  id: string;
  label: string;
  status: ConsistencyStatus;
  message: string;
  documents: ConsistencyDocumentId[];
}

export interface DocumentReadiness {
  id: ConsistencyDocumentId;
  name: string;
  readyCount: number;
  requiredCount: number;
  missing: string[];
  ready: boolean;
}

export interface CrossDocumentConsistencyReport {
  checks: ConsistencyCheck[];
  blockers: ConsistencyCheck[];
  warnings: ConsistencyCheck[];
  passes: ConsistencyCheck[];
  documentReadiness: DocumentReadiness[];
  canPackage: boolean;
}

function hasText(value?: string) {
  return Boolean(value?.trim());
}

function normalizeLabel(value: string) {
  return value.trim().replace(/\s+/g, '').replace(/[，、；;。．.：:()（）]/g, '').toLowerCase();
}

function configuredPricingItems(procurementCase: ProcurementCase) {
  return (procurementCase.pricingItems ?? []).filter((item) => item.description.trim());
}

function pricingEstimateTotal(items: PricingItem[]) {
  return items.reduce((sum, item) => {
    if (item.quantity === undefined || item.estimatedUnitPrice === undefined) return sum;
    return sum + item.quantity * item.estimatedUnitPrice;
  }, 0);
}

function readiness(
  id: ConsistencyDocumentId,
  name: string,
  fields: Array<[string, boolean]>,
): DocumentReadiness {
  const missing = fields.filter(([, ready]) => !ready).map(([label]) => label);
  return {
    id,
    name,
    readyCount: fields.length - missing.length,
    requiredCount: fields.length,
    missing,
    ready: missing.length === 0,
  };
}

function pushCheck(
  checks: ConsistencyCheck[],
  id: string,
  label: string,
  status: ConsistencyStatus,
  message: string,
  documents: ConsistencyDocumentId[],
) {
  checks.push({ id, label, status, message, documents });
}

export function buildCrossDocumentConsistencyReport(procurementCase: ProcurementCase): CrossDocumentConsistencyReport {
  const checks: ConsistencyCheck[] = [];
  const pricingItems = configuredPricingItems(procurementCase);
  const mappingPreviews = buildAllTemplateMappingPreviews(procurementCase);
  const tenderPreview = mappingPreviews.find((item) => item.templateId === 'tender-instructions');
  const servicePreview = mappingPreviews.find((item) => item.templateId === 'service-contract');
  const guidance = buildProcurementGuidance(procurementCase);
  const validProcurementMethod = isGuidanceOptionValue(procurementCase.procurementMethod, guidance.methodOptions);
  const validAwardPrinciple = validProcurementMethod
    && isGuidanceOptionValue(procurementCase.awardPrinciple, guidance.awardPrincipleOptions);
  const validAwardMethod = isGuidanceOptionValue(procurementCase.awardMethod, guidance.awardMethodOptions);
  const validContractPriceMethod = isGuidanceOptionValue(
    procurementCase.contractPriceMethod,
    guidance.contractPriceMethodOptions,
  );

  const isService = procurementCase.category === 'service';
  pushCheck(
    checks,
    'category-service',
    '採購類型',
    isService ? 'pass' : 'blocker',
    isService ? '目前為勞務採購，可套用勞務 Happy Path。' : '目前完整文件包只支援勞務採購；請先確認採購類型。',
    ['tender-instructions', 'service-contract', 'service-requirements', 'price-schedule'],
  );

  const coreIdentityReady = hasText(procurementCase.agency) && hasText(procurementCase.title);
  pushCheck(
    checks,
    'identity',
    '機關與案名',
    coreIdentityReady ? 'pass' : 'blocker',
    coreIdentityReady ? '機關名稱與標案名稱可由單一案件來源同步使用。' : '機關名稱或標案名稱尚未填寫，無法產生一致的正式文件標頭。',
    ['tender-instructions', 'service-contract', 'service-requirements', 'price-schedule'],
  );

  const budgetReady = procurementCase.budget > 0;
  pushCheck(
    checks,
    'budget',
    '預算金額',
    budgetReady ? 'pass' : 'blocker',
    budgetReady ? `案件預算為新臺幣 ${Math.round(procurementCase.budget).toLocaleString('zh-TW')} 元。` : '尚未填寫有效預算金額。',
    ['tender-instructions', 'service-requirements'],
  );

  const invalidGuidedSelections = [
    [procurementCase.procurementMethod, validProcurementMethod, '招標方式'],
    [procurementCase.awardPrinciple, validAwardPrinciple, '決標原則'],
    [procurementCase.awardMethod, validAwardMethod, '決標方式'],
    [procurementCase.contractPriceMethod, validContractPriceMethod, '契約價金計算方式'],
  ].filter(([value, valid]) => hasText(String(value ?? '')) && !valid);
  if (invalidGuidedSelections.length) {
    pushCheck(
      checks,
      'guided-selection-validity',
      '採購程序關聯選項',
      'blocker',
      `下列欄位不符合目前金額、採購類型或前置選項：${invalidGuidedSelections.map((item) => item[2]).join('、')}。請從關聯下拉選單重新確認。`,
      ['tender-instructions', 'service-contract'],
    );
  }

  const periodReady = Boolean(procurementCase.contractStart && procurementCase.contractEnd);
  const periodOrdered = !periodReady || procurementCase.contractStart! <= procurementCase.contractEnd!;
  pushCheck(
    checks,
    'period-complete',
    '履約期間完整性',
    periodReady ? 'pass' : 'blocker',
    periodReady ? `${procurementCase.contractStart} ～ ${procurementCase.contractEnd}` : '履約開始日或結束日尚未填寫。',
    ['service-contract', 'service-requirements'],
  );
  if (periodReady) {
    pushCheck(
      checks,
      'period-order',
      '履約日期順序',
      periodOrdered ? 'pass' : 'blocker',
      periodOrdered ? '履約開始日期未晚於履約結束日期。' : '履約開始日期晚於履約結束日期，必須先修正。',
      ['service-contract', 'service-requirements'],
    );
  }

  const descriptionReady = hasText(procurementCase.description);
  pushCheck(
    checks,
    'scope',
    '履約標的／採購需求',
    descriptionReady ? 'pass' : 'blocker',
    descriptionReady ? '採購需求可同步供契約與需求規格書使用。' : '採購需求尚未填寫，契約履約標的與需求規格書缺少共同來源。',
    ['service-contract', 'service-requirements'],
  );

  const deliverables = procurementCase.deliverables.map((item) => item.trim()).filter(Boolean);
  pushCheck(
    checks,
    'deliverables',
    '主要交付成果',
    deliverables.length ? 'pass' : 'blocker',
    deliverables.length ? `已設定 ${deliverables.length} 項主要交付成果。` : '尚未設定主要交付成果，需求規格書、契約與標價清單無法交叉核對。',
    ['service-contract', 'service-requirements', 'price-schedule'],
  );

  const paymentReady = hasText(procurementCase.paymentTerms);
  pushCheck(
    checks,
    'payment',
    '付款條件',
    paymentReady ? 'pass' : 'blocker',
    paymentReady ? '付款條件已有單一來源。' : '付款條件尚未填寫。',
    ['service-contract', 'service-requirements'],
  );

  const acceptanceReady = hasText(procurementCase.acceptanceMethod);
  pushCheck(
    checks,
    'acceptance',
    '驗收方式',
    acceptanceReady ? 'pass' : 'blocker',
    acceptanceReady ? '驗收方式已有單一來源。' : '驗收方式尚未填寫。',
    ['service-contract', 'service-requirements'],
  );

  const tenderRequiredReady = Boolean(tenderPreview && tenderPreview.readyRequiredCount === tenderPreview.requiredCount);
  pushCheck(
    checks,
    'tender-mapping',
    '投標須知必要欄位',
    tenderRequiredReady ? 'pass' : 'blocker',
    tenderRequiredReady
      ? `投標須知必要 Mapping ${tenderPreview!.readyRequiredCount}/${tenderPreview!.requiredCount} 已完成。`
      : `投標須知必要 Mapping 僅 ${tenderPreview?.readyRequiredCount ?? 0}/${tenderPreview?.requiredCount ?? 0}；請補齊招標方式、決標原則、決標方式及廠商資格等必要欄位。`,
    ['tender-instructions'],
  );

  if (isService) {
    const serviceRequiredReady = Boolean(servicePreview && servicePreview.readyRequiredCount === servicePreview.requiredCount);
    pushCheck(
      checks,
      'service-mapping',
      '勞務契約必要欄位',
      serviceRequiredReady ? 'pass' : 'blocker',
      serviceRequiredReady
        ? `勞務契約必要 Mapping ${servicePreview!.readyRequiredCount}/${servicePreview!.requiredCount} 已完成。`
        : `勞務契約必要 Mapping 僅 ${servicePreview?.readyRequiredCount ?? 0}/${servicePreview?.requiredCount ?? 0}；請補齊計價方式、付款、履約期間、驗收與交付成果。`,
      ['service-contract'],
    );
  }

  const pricingExists = pricingItems.length > 0;
  pushCheck(
    checks,
    'pricing-exists',
    '標價項目',
    pricingExists ? 'pass' : 'blocker',
    pricingExists ? `已建立 ${pricingItems.length} 個標價項目。` : '尚未建立標價項目。',
    ['price-schedule'],
  );

  if (pricingExists) {
    const incompletePricing = pricingItems.filter(
      (item) => item.quantity === undefined || item.quantity <= 0 || !hasText(item.unit),
    );
    pushCheck(
      checks,
      'pricing-structure',
      '標價項目數量／單位',
      incompletePricing.length ? 'blocker' : 'pass',
      incompletePricing.length
        ? `有 ${incompletePricing.length} 個標價項目缺少有效數量或單位；對外 XLSX 尚不可視為完整。`
        : '所有標價項目均已有有效數量與單位。',
      ['price-schedule'],
    );

    const normalizedDescriptions = pricingItems.map((item) => normalizeLabel(item.description));
    const duplicates = normalizedDescriptions.filter((value, index) => value && normalizedDescriptions.indexOf(value) !== index);
    if (duplicates.length) {
      pushCheck(
        checks,
        'pricing-duplicates',
        '標價項目重複',
        'warning',
        '標價清單存在名稱重複的工作項目，請確認是否應合併或區分規格。',
        ['price-schedule', 'service-requirements'],
      );
    }

    if (deliverables.length) {
      const pricingSet = new Set(normalizedDescriptions);
      const missingFromPricing = deliverables.filter((item) => !pricingSet.has(normalizeLabel(item)));
      pushCheck(
        checks,
        'deliverable-pricing-coverage',
        '交付成果與標價項目對照',
        missingFromPricing.length ? 'warning' : 'pass',
        missingFromPricing.length
          ? `有 ${missingFromPricing.length} 項交付成果未以同名項目出現在標價清單：${missingFromPricing.join('、')}。若採總包價或包含於其他項目，請人工確認。`
          : '主要交付成果均可在標價項目中找到同名對應。',
        ['service-contract', 'service-requirements', 'price-schedule'],
      );
    }

    const fullyEstimated = pricingItems.every(
      (item) => item.quantity !== undefined && item.quantity > 0 && item.estimatedUnitPrice !== undefined && item.estimatedUnitPrice >= 0,
    );
    if (fullyEstimated && budgetReady) {
      const estimate = pricingEstimateTotal(pricingItems);
      const difference = procurementCase.budget - estimate;
      pushCheck(
        checks,
        'pricing-budget',
        '內部估價與預算',
        Math.abs(difference) < 1 ? 'pass' : 'warning',
        Math.abs(difference) < 1
          ? '內部標價項目估算合計與案件預算一致。'
          : difference > 0
            ? `內部標價項目估算合計較案件預算少新臺幣 ${Math.round(difference).toLocaleString('zh-TW')} 元。`
            : `內部標價項目估算合計超過案件預算新臺幣 ${Math.round(Math.abs(difference)).toLocaleString('zh-TW')} 元。`,
        ['tender-instructions', 'price-schedule'],
      );
    } else if (pricingExists) {
      pushCheck(
        checks,
        'pricing-budget',
        '內部估價與預算',
        'warning',
        '部分標價項目尚未填內部預估單價，因此目前無法完成預算合計交叉檢查；此欄不會寫入對外 XLSX。',
        ['tender-instructions', 'price-schedule'],
      );
    }
  }

  if (procurementCase.reservePrice !== undefined && budgetReady && procurementCase.reservePrice > procurementCase.budget) {
    pushCheck(
      checks,
      'reserve-price-budget',
      '底價／預估底價',
      'warning',
      '底價／預估底價高於案件預算，請在正式招標前人工確認。此敏感值不會寫入對外文件。',
      ['tender-instructions'],
    );
  }

  const documentReadiness: DocumentReadiness[] = [
    readiness('tender-instructions', '投標須知', [
      ['標案名稱', hasText(procurementCase.title)],
      ['採購類型', procurementCase.category !== 'unknown'],
      ['預算金額', budgetReady],
      ['招標方式', validProcurementMethod],
      ['決標原則', validAwardPrinciple],
      ['決標方式', validAwardMethod],
      ['廠商資格', hasText(procurementCase.vendorQualification)],
    ]),
    readiness('service-contract', '勞務採購契約', [
      ['招標機關', hasText(procurementCase.agency)],
      ['履約標的', descriptionReady],
      ['交付成果', deliverables.length > 0],
      ['契約價金計算方式', validContractPriceMethod],
      ['付款條件', paymentReady],
      ['履約期間', periodReady && periodOrdered],
      ['驗收方式', acceptanceReady],
    ]),
    readiness('service-requirements', '需求規格書', [
      ['招標機關', hasText(procurementCase.agency)],
      ['標案名稱', hasText(procurementCase.title)],
      ['預算金額', budgetReady],
      ['採購需求', descriptionReady],
      ['履約期間', periodReady && periodOrdered],
      ['交付成果', deliverables.length > 0],
      ['驗收方式', acceptanceReady],
      ['付款條件', paymentReady],
      ['廠商資格', hasText(procurementCase.vendorQualification)],
    ]),
    readiness('price-schedule', '標價清單', [
      ['招標機關', hasText(procurementCase.agency)],
      ['標案名稱', hasText(procurementCase.title)],
      ['標價項目', pricingExists],
      ['各項數量與單位', pricingExists && pricingItems.every((item) => item.quantity !== undefined && item.quantity > 0 && hasText(item.unit))],
    ]),
  ];

  const blockers = checks.filter((item) => item.status === 'blocker');
  const warnings = checks.filter((item) => item.status === 'warning');
  const passes = checks.filter((item) => item.status === 'pass');

  return {
    checks,
    blockers,
    warnings,
    passes,
    documentReadiness,
    canPackage: blockers.length === 0 && documentReadiness.every((item) => item.ready),
  };
}
