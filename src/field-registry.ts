import type {
  FieldDefinition,
  FieldOption,
  ProcurementCase,
  ProcurementCategory,
} from './types';
import { PROCUREMENT_VALUES } from './procurement-guidance.ts';

/**
 * Stable values used by the v2 decision fields.  They intentionally do not
 * reuse the legacy display strings, which may contain a different encoding in
 * an old case.  Writers can continue to use the legacy properties while the
 * workflow UI uses these values for deterministic branching.
 */
export const SERVICE_DECISION_VALUES = {
  directSmall: 'direct-small',
  publicQuote: 'public-quote',
  openTender: 'open-tender',
  selectiveTender: 'selective-tender',
  restrictedTender: 'restricted-tender',
  lowestWithReserve: 'lowest-with-reserve',
  lowestWithoutReserve: 'lowest-without-reserve',
  referenceMostAdvantageous: 'reference-most-advantageous',
  mostAdvantageous: 'most-advantageous',
  scoredLowest: 'scored-lowest',
  suitableSmall: 'suitable-small',
  quasiMostAdvantageous: 'quasi-most-advantageous',
  totalAward: 'total-award',
  itemAward: 'item-award',
  groupAward: 'group-award',
  quantityAward: 'quantity-award',
  unitAward: 'unit-award',
  otherAward: 'other-award',
  lumpSum: 'lump-sum',
  unitPrice: 'unit-price',
  monthly: 'monthly',
  daily: 'daily',
  hourly: 'hourly',
  costPlusFee: 'cost-plus-fee',
  bidBondNone: 'bid-bond-none',
  bidBondRequired: 'bid-bond-required',
  performanceBondNone: 'performance-bond-none',
  performanceBondRequired: 'performance-bond-required',
  insuranceNone: 'insurance-none',
  insuranceRequired: 'insurance-required',
} as const;

const pccProcurementActUrl = 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030057';
const pccTenderTemplateUrl = 'https://www.pcc.gov.tw/content/index?eid=9808&type=C';
const pccServiceContractUrl = 'https://www.pcc.gov.tw/content/index?eid=9816&type=C';

/** Stable v2 values are deliberately separate from the display strings used
 * by existing writers.  Keeping this map next to the registry makes the
 * conversion auditable and avoids copying mojibake-prone legacy literals. */
const legacyValueByStableValue: Record<string, string> = {
  [SERVICE_DECISION_VALUES.directSmall]: PROCUREMENT_VALUES.directSmall,
  [SERVICE_DECISION_VALUES.publicQuote]: PROCUREMENT_VALUES.publicQuote,
  [SERVICE_DECISION_VALUES.openTender]: PROCUREMENT_VALUES.openTender,
  [SERVICE_DECISION_VALUES.selectiveTender]: PROCUREMENT_VALUES.selectiveTender,
  [SERVICE_DECISION_VALUES.restrictedTender]: PROCUREMENT_VALUES.restrictedTender,
  [SERVICE_DECISION_VALUES.lowestWithReserve]: PROCUREMENT_VALUES.lowestWithReserve,
  [SERVICE_DECISION_VALUES.lowestWithoutReserve]: PROCUREMENT_VALUES.lowestWithoutReserve,
  [SERVICE_DECISION_VALUES.referenceMostAdvantageous]: PROCUREMENT_VALUES.referenceMostAdvantageous,
  [SERVICE_DECISION_VALUES.mostAdvantageous]: PROCUREMENT_VALUES.mostAdvantageous,
  [SERVICE_DECISION_VALUES.quasiMostAdvantageous]: PROCUREMENT_VALUES.quasiMostAdvantageous,
  [SERVICE_DECISION_VALUES.scoredLowest]: PROCUREMENT_VALUES.scoredLowest,
  [SERVICE_DECISION_VALUES.suitableSmall]: PROCUREMENT_VALUES.suitableSmall,
  [SERVICE_DECISION_VALUES.totalAward]: PROCUREMENT_VALUES.totalAward,
  [SERVICE_DECISION_VALUES.itemAward]: PROCUREMENT_VALUES.itemAward,
  [SERVICE_DECISION_VALUES.groupAward]: PROCUREMENT_VALUES.groupAward,
  [SERVICE_DECISION_VALUES.quantityAward]: PROCUREMENT_VALUES.quantityAward,
  [SERVICE_DECISION_VALUES.unitAward]: PROCUREMENT_VALUES.unitAward,
  [SERVICE_DECISION_VALUES.otherAward]: PROCUREMENT_VALUES.otherAward,
  [SERVICE_DECISION_VALUES.lumpSum]: PROCUREMENT_VALUES.totalPackage,
  [SERVICE_DECISION_VALUES.unitPrice]: PROCUREMENT_VALUES.unitPrice,
  [SERVICE_DECISION_VALUES.monthly]: PROCUREMENT_VALUES.monthly,
  [SERVICE_DECISION_VALUES.daily]: PROCUREMENT_VALUES.daily,
  [SERVICE_DECISION_VALUES.hourly]: PROCUREMENT_VALUES.hourly,
  [SERVICE_DECISION_VALUES.costPlusFee]: PROCUREMENT_VALUES.costPlusFee,
  [SERVICE_DECISION_VALUES.bidBondNone]: 'none',
  [SERVICE_DECISION_VALUES.bidBondRequired]: 'required',
  [SERVICE_DECISION_VALUES.performanceBondNone]: 'none',
  [SERVICE_DECISION_VALUES.performanceBondRequired]: 'required',
  [SERVICE_DECISION_VALUES.insuranceNone]: 'none',
  [SERVICE_DECISION_VALUES.insuranceRequired]: 'required',
};

const option = (
  value: string,
  label: string,
  description: string,
  recommendation?: string,
  legalBasis = pccProcurementActUrl,
): FieldOption => ({
  value,
  legacyValue: legacyValueByStableValue[value],
  label,
  description,
  recommendation,
  legalBasis,
});

const procurementMethodOptions: FieldOption[] = [
  option(SERVICE_DECISION_VALUES.directSmall, '小額採購', '適用於法定小額採購範圍；仍須依機關內控程序辦理。'),
  option(SERVICE_DECISION_VALUES.publicQuote, '公開取得報價或企劃書', '在公告金額以下以公開方式取得報價或企劃書。'),
  option(SERVICE_DECISION_VALUES.openTender, '公開招標', '以公開招標方式邀請廠商投標，適合一般競爭性採購。', '一般服務採購的預設起點。'),
  option(SERVICE_DECISION_VALUES.selectiveTender, '選擇性招標', '先辦理資格審查，再邀請合格廠商投標；須記錄採用理由。'),
  option(SERVICE_DECISION_VALUES.restrictedTender, '限制性招標', '僅在法定例外事由下採用；須記錄事由及核准依據。'),
];

const awardPrincipleOptions: FieldOption[] = [
  option(
    SERVICE_DECISION_VALUES.lowestWithReserve,
    '最低標（訂有底價）',
    '符合招標文件要求且價格最低者得標，並以核定底價作為價格管制。',
    '規格可明確量化且機關已規劃底價時。',
  ),
  option(
    SERVICE_DECISION_VALUES.lowestWithoutReserve,
    '最低標（未訂底價）',
    '符合招標文件要求且價格最低者得標，不另訂底價；須確認價格合理性及程序。',
    '不宜或依法不訂底價時，應記錄理由。',
  ),
  option(
    SERVICE_DECISION_VALUES.referenceMostAdvantageous,
    '參考最有利標精神',
    '以評審方式擇優，並依公告金額以下採購規範辦理。',
    '服務品質差異明顯、需要評估企劃內容時。',
  ),
  option(SERVICE_DECISION_VALUES.mostAdvantageous, '最有利標', '依評選項目及配分擇定最有利標，須完成評選規則。'),
  option(
    SERVICE_DECISION_VALUES.quasiMostAdvantageous,
    '準用最有利標',
    '在適用情形下準用最有利標精神辦理，須確認法定依據及評審規則。',
  ),
  option(SERVICE_DECISION_VALUES.scoredLowest, '評分及格最低標', '先以評分確認合格，再以價格最低決標。'),
  option(
    SERVICE_DECISION_VALUES.suitableSmall,
    '最符合需要（小額採購）',
    '小額採購以符合需求且價格合理者為原則，須保存比較及合理性紀錄。',
  ),
];

const awardMethodOptions: FieldOption[] = [
  option(SERVICE_DECISION_VALUES.totalAward, '總價決標', '以全部工作項目的總價作為決標單位。'),
  option(SERVICE_DECISION_VALUES.itemAward, '分項決標', '各工作項目分別決標；需說明分項及最低投標單位。'),
  option(SERVICE_DECISION_VALUES.groupAward, '分組決標', '依工作性質分組決標；需列明分組方式。'),
  option(SERVICE_DECISION_VALUES.quantityAward, '按數量決標', '依招標文件所定數量及單價比較決標。'),
  option(SERVICE_DECISION_VALUES.unitAward, '單價決標', '以單價作為決標基準，實際數量依契約約定結算。'),
  option(SERVICE_DECISION_VALUES.otherAward, '其他', '非上述方式時填寫具體決標單位及理由。'),
];

const priceMethodOptions: FieldOption[] = [
  option(SERVICE_DECISION_VALUES.lumpSum, '總包價', '以完成全部契約工作所需的固定總價計價。', '工作範圍及成果可事先明確界定時。'),
  option(SERVICE_DECISION_VALUES.unitPrice, '單價計價', '按實際數量乘以契約單價結算。'),
  option(SERVICE_DECISION_VALUES.monthly, '按月計價', '按每月完成且驗收的服務計付。'),
  option(SERVICE_DECISION_VALUES.daily, '按日計價', '按實際履約日數及約定日單價計付。'),
  option(SERVICE_DECISION_VALUES.hourly, '按時計價', '按實際工時及約定時薪計付。'),
  option(SERVICE_DECISION_VALUES.costPlusFee, '成本加公費', '按核實成本加計約定公費；須明列成本認定及上限。'),
];

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

function fieldValue(procurementCase: ProcurementCase, id: string, legacyKey?: keyof ProcurementCase): unknown {
  const mapped = procurementCase.fields?.[id]?.value;
  if (hasValue(mapped)) return mapped;
  return legacyKey ? procurementCase[legacyKey] : undefined;
}

function serviceCase(procurementCase: ProcurementCase): boolean {
  return procurementCase.category === 'service' || fieldValue(procurementCase, 'requirements.category', 'category') === 'service';
}

function methodChosen(procurementCase: ProcurementCase): boolean {
  return hasValue(fieldValue(procurementCase, 'decisions.procurementMethod', 'procurementMethod'));
}

function evaluationDetailsRequired(procurementCase: ProcurementCase): boolean {
  const principle = fieldValue(procurementCase, 'decisions.awardPrinciple', 'awardPrinciple');
  const requiredPrinciples: readonly string[] = [
    SERVICE_DECISION_VALUES.referenceMostAdvantageous,
    SERVICE_DECISION_VALUES.mostAdvantageous,
    SERVICE_DECISION_VALUES.quasiMostAdvantageous,
    SERVICE_DECISION_VALUES.scoredLowest,
  ];
  return typeof principle === 'string' && requiredPrinciples.includes(principle);
}

function bidBondDetailsRequired(procurementCase: ProcurementCase): boolean {
  return fieldValue(procurementCase, 'decisions.bidBond', 'bidBond') === SERVICE_DECISION_VALUES.bidBondRequired;
}

function performanceBondDetailsRequired(procurementCase: ProcurementCase): boolean {
  return fieldValue(procurementCase, 'decisions.performanceBond', 'performanceBond') === SERVICE_DECISION_VALUES.performanceBondRequired;
}

function insuranceWaiverReasonRequired(procurementCase: ProcurementCase): boolean {
  return fieldValue(procurementCase, 'contract.insuranceRequired') === SERVICE_DECISION_VALUES.insuranceNone;
}

function insuranceSelected(procurementCase: ProcurementCase): boolean {
  const value = fieldValue(procurementCase, 'contract.insuranceRequired');
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === SERVICE_DECISION_VALUES.insuranceRequired
      || !['no', 'none', '否', '無', '不適用', SERVICE_DECISION_VALUES.insuranceNone].includes(normalized);
  }
  return false;
}

function sensitiveCase(procurementCase: ProcurementCase): boolean {
  return procurementCase.securityLevel === 'SENSITIVE' || procurementCase.securityLevel === 'RESTRICTED';
}

function validateServiceCategory(value: unknown): string | undefined {
  return value === 'service' ? undefined : '普通勞務流程目前僅支援「勞務」類別，請選擇正確類別。';
}

function validatePositiveBudget(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? undefined
    : '預算金額必須是大於 0 的數字。';
}

function validateContractEnd(value: unknown, procurementCase: ProcurementCase): string | undefined {
  if (typeof value !== 'string' || !value.trim() || !procurementCase.contractStart) return undefined;
  const start = Date.parse(procurementCase.contractStart);
  const end = Date.parse(value);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '履約起訖日期格式無法辨識，請重新輸入。';
  return end >= start ? undefined : '履約截止日不得早於開始日。';
}

function validatePricingItems(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return '至少建立一項標價清單工作項目。';
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') return `第 ${index + 1} 項工作項目資料格式不正確。`;
    const candidate = item as { description?: unknown; quantity?: unknown; unit?: unknown };
    if (typeof candidate.description !== 'string' || !candidate.description.trim()) {
      return `第 ${index + 1} 項工作項目缺少工作內容。`;
    }
    if (typeof candidate.quantity !== 'number' || !Number.isFinite(candidate.quantity) || candidate.quantity <= 0) {
      return `第 ${index + 1} 項工作項目的數量必須大於 0。`;
    }
    if (typeof candidate.unit !== 'string' || !candidate.unit.trim()) {
      return `第 ${index + 1} 項工作項目缺少單位。`;
    }
  }
  return undefined;
}

/**
 * First vertical slice of the field registry.  It covers ordinary service
 * procurements and deliberately describes the *decision* behind a field so a
 * UI can explain it before asking for an answer.
 */
export const ordinaryServiceFieldRegistry: readonly FieldDefinition[] = [
  {
    id: 'requirements.title',
    label: '案件名稱',
    section: 'requirements',
    dataType: 'text',
    requirement: 'required',
    purpose: '識別本次採購案件並同步至所有文件標題。',
    helpText: '請填寫正式採購名稱，避免只填內部簡稱。',
    legacyKey: 'title',
    targets: ['requirements', 'tender', 'contract'],
  },
  {
    id: 'requirements.agency',
    label: '機關名稱',
    section: 'requirements',
    dataType: 'text',
    requirement: 'required',
    purpose: '確認招標及契約主體。',
    helpText: '填寫依法辦理採購的機關全銜。',
    legacyKey: 'agency',
    targets: ['requirements', 'tender', 'contract'],
  },
  {
    id: 'requirements.category',
    label: '採購類別',
    section: 'requirements',
    dataType: 'select',
    requirement: 'required',
    purpose: '決定可使用的招標及契約範本。',
    helpText: '一般服務案件選擇「勞務」；若含工程或財物主要內容，應重新判斷。',
    legalBasis: pccTenderTemplateUrl,
    options: [
      option('service', '勞務', '以提供服務、專業或人力為主要標的。'),
      option('goods', '財物', '以購置有形物品為主要標的。'),
      option('construction', '工程', '以工程施工或建造為主要標的。'),
    ],
    legacyKey: 'category',
    validate: validateServiceCategory,
    targets: ['requirements', 'tender', 'contract'],
  },
  {
    id: 'requirements.budget',
    label: '預算金額',
    section: 'requirements',
    dataType: 'number',
    requirement: 'required',
    purpose: '判斷金額級距及可用的招標方式選項。',
    helpText: '請填含稅預算或可核定的預算上限；不得以內部估價取代核定預算。',
    legacyKey: 'budget',
    validate: validatePositiveBudget,
    targets: ['requirements', 'tender', 'contract'],
  },
  {
    id: 'requirements.description',
    label: '採購目的與範圍',
    section: 'requirements',
    dataType: 'multiline',
    requirement: 'required',
    purpose: '形成需求說明書及契約工作範圍。',
    helpText: '說明要解決的問題、服務邊界、地點及不包含事項。',
    legacyKey: 'description',
    targets: ['requirements', 'tender', 'contract'],
  },
  {
    id: 'requirements.contractStart',
    label: '履約開始日',
    section: 'requirements',
    dataType: 'date',
    requirement: 'required',
    purpose: '確定契約期間及逾期計算起點。',
    helpText: '若採通知日起算，請改在履約期間欄位說明起算方式。',
    legacyKey: 'contractStart',
    targets: ['requirements', 'contract'],
  },
  {
    id: 'requirements.contractEnd',
    label: '履約截止日',
    section: 'requirements',
    dataType: 'date',
    requirement: 'required',
    purpose: '確定契約期間及逾期計算終點。',
    helpText: '需與里程碑及驗收時間一致。',
    legacyKey: 'contractEnd',
    validate: validateContractEnd,
    targets: ['requirements', 'contract'],
  },
  {
    id: 'requirements.deliverables',
    label: '主要交付成果',
    section: 'requirements',
    dataType: 'deliverables',
    requirement: 'required',
    purpose: '建立工作項目、驗收依據及付款節點。',
    helpText: '每項成果請用可驗證的名稱描述；系統不會自行猜測數量、單位或價格。',
    legacyKey: 'deliverables',
    targets: ['requirements', 'tender', 'contract', 'price-schedule'],
  },
  {
    id: 'requirements.paymentTerms',
    label: '付款條件',
    section: 'requirements',
    dataType: 'multiline',
    requirement: 'required',
    purpose: '將成果、驗收與付款時點連結。',
    helpText: '請說明請款文件、付款比例及各期應完成的成果。',
    legacyKey: 'paymentTerms',
    targets: ['requirements', 'contract'],
  },
  {
    id: 'requirements.acceptanceMethod',
    label: '驗收方式',
    section: 'requirements',
    dataType: 'multiline',
    requirement: 'required',
    purpose: '定義機關如何判斷成果符合契約。',
    helpText: '請填驗收程序、期限、文件及不合格處理方式。',
    legacyKey: 'acceptanceMethod',
    targets: ['requirements', 'contract'],
  },
  {
    id: 'requirements.vendorQualification',
    label: '廠商資格',
    section: 'requirements',
    dataType: 'multiline',
    requirement: 'required',
    purpose: '確認廠商具備履行本案所需能力，避免資格過度或不足。',
    helpText: '每項資格應能說明與履約能力的關聯及查驗文件。',
    legacyKey: 'vendorQualification',
    targets: ['requirements', 'tender'],
  },
  {
    id: 'pricing.items',
    label: '標價清單工作項目',
    section: 'pricing',
    dataType: 'pricing-items',
    requirement: 'required',
    purpose: '把交付成果轉成可報價及驗收的工作項目。',
    helpText: '可由交付成果建立項目；數量、單位及價格由使用者確認，預估單價只供內部試算。',
    legacyKey: 'pricingItems',
    validate: validatePricingItems,
    targets: ['tender', 'contract', 'price-schedule'],
  },
  {
    id: 'decisions.procurementMethod',
    label: '招標方式',
    section: 'decisions',
    dataType: 'select',
    requirement: 'required',
    purpose: '依金額級距及案件特性決定招標程序。',
    helpText: '系統先列出金額級距允許的選項與建議，最後由機關確認並記錄理由。',
    legalBasis: pccTenderTemplateUrl,
    options: procurementMethodOptions,
    legacyKey: 'procurementMethod',
    targets: ['tender', 'contract'],
  },
  {
    id: 'decisions.awardPrinciple',
    label: '決標原則',
    section: 'decisions',
    dataType: 'select',
    requirement: 'conditional',
    purpose: '決定以價格、品質或評分方式擇定得標廠商。',
    helpText: '選擇評選或最有利標時，系統會再要求評審項目、配分及及格門檻。',
    legalBasis: pccTenderTemplateUrl,
    options: awardPrincipleOptions,
    legacyKey: 'awardPrinciple',
    appliesWhen: methodChosen,
    targets: ['tender', 'contract'],
  },
  {
    id: 'decisions.awardMethod',
    label: '決標方式',
    section: 'decisions',
    dataType: 'select',
    requirement: 'conditional',
    purpose: '決定以總價、分項、分組或單價作為決標單位。',
    helpText: '請確認與標價清單項目及付款結算方式一致。',
    legalBasis: pccTenderTemplateUrl,
    options: awardMethodOptions,
    legacyKey: 'awardMethod',
    appliesWhen: methodChosen,
    targets: ['tender', 'contract', 'price-schedule'],
  },
  {
    id: 'decisions.evaluationDetails',
    label: '評審及評分規則',
    section: 'decisions',
    dataType: 'multiline',
    requirement: 'conditional',
    purpose: '把評選或評分決標原則轉成廠商可預見的評審規則。',
    helpText: '請說明評審項目、配分、及格門檻、價格是否納入、排序及同分處理。',
    legalBasis: pccTenderTemplateUrl,
    appliesWhen: evaluationDetailsRequired,
    targets: ['tender', 'contract'],
  },
  {
    id: 'decisions.contractPriceMethod',
    label: '契約價金計算方式',
    section: 'decisions',
    dataType: 'select',
    requirement: 'conditional',
    purpose: '決定契約價金及實際結算方式。',
    helpText: '系統會依勞務類型列出總包、單價、按月、按日或按時計價等選項。',
    legalBasis: pccServiceContractUrl,
    options: priceMethodOptions,
    legacyKey: 'contractPriceMethod',
    appliesWhen: serviceCase,
    targets: ['contract', 'price-schedule'],
  },
  {
    id: 'decisions.bidBond',
    label: '押標金',
    section: 'decisions',
    dataType: 'select',
    requirement: 'required',
    purpose: '確認是否收取押標金及其金額、繳納方式。',
    helpText: '請選擇有無押標金；選擇收取後，還要填金額、有效期及退還條件。',
    legalBasis: pccTenderTemplateUrl,
    options: [
      option(SERVICE_DECISION_VALUES.bidBondNone, '不收取', '不收押標金；應確認是否有免收或不收的法定及個案理由。'),
      option(SERVICE_DECISION_VALUES.bidBondRequired, '收取', '收取押標金；須補充金額、繳納方式及有效期間。'),
    ],
    legacyKey: 'bidBond',
    targets: ['tender'],
  },
  {
    id: 'decisions.bidBondDetails',
    label: '押標金詳細條件',
    section: 'decisions',
    dataType: 'multiline',
    requirement: 'conditional',
    purpose: '補足押標金金額、繳納方式及有效期間，讓投標文件可直接引用。',
    helpText: '選擇收取押標金後，請填金額、繳納／保證形式、有效期間及退還條件。',
    legalBasis: pccTenderTemplateUrl,
    appliesWhen: bidBondDetailsRequired,
    targets: ['tender'],
  },
  {
    id: 'decisions.performanceBond',
    label: '履約保證金',
    section: 'decisions',
    dataType: 'select',
    requirement: 'required',
    purpose: '確認履約保證金政策及後續契約條款。',
    helpText: '請選擇有無履約保證金；選擇收取後，還要填金額、形式及返還時點。',
    legalBasis: pccTenderTemplateUrl,
    options: [
      option(SERVICE_DECISION_VALUES.performanceBondNone, '不收取', '不收履約保證金；應確認個案風險及理由。'),
      option(SERVICE_DECISION_VALUES.performanceBondRequired, '收取', '收取履約保證金；須補充金額、形式及有效期間。'),
    ],
    legacyKey: 'performanceBond',
    targets: ['tender', 'contract'],
  },
  {
    id: 'decisions.performanceBondDetails',
    label: '履約保證金詳細條件',
    section: 'decisions',
    dataType: 'multiline',
    requirement: 'conditional',
    purpose: '補足履約保證金金額、形式及返還時點，讓契約條款可直接引用。',
    helpText: '選擇收取履約保證金後，請填金額、保證形式、有效期間及返還條件。',
    legalBasis: pccTenderTemplateUrl,
    appliesWhen: performanceBondDetailsRequired,
    targets: ['tender', 'contract'],
  },
  {
    id: 'contract.insuranceRequired',
    label: '保險需求',
    section: 'contract',
    dataType: 'select',
    requirement: 'conditional',
    purpose: '依人員、活動、旅行、設備或施工風險決定保險。',
    helpText: '一般活動服務常見公共意外責任；派遣人力、旅行安排等情形應再檢查適用險種。',
    legalBasis: pccServiceContractUrl,
    options: [
      option(SERVICE_DECISION_VALUES.insuranceNone, '不要求保險', '不要求廠商投保；應填寫風險評估及不要求理由。'),
      option(SERVICE_DECISION_VALUES.insuranceRequired, '要求保險', '要求投保；須補充險種、保額、自負額、期間及證明文件。'),
    ],
    appliesWhen: serviceCase,
    targets: ['contract'],
  },
  {
    id: 'contract.insuranceTypes',
    label: '保險種類與保額',
    section: 'contract',
    dataType: 'multiline',
    requirement: 'conditional',
    purpose: '把已選擇的保險需求轉成可驗證的契約條件。',
    helpText: '請列明險種、最低保額、自負額、保險期間及受益／被保險人。',
    legalBasis: pccServiceContractUrl,
    appliesWhen: insuranceSelected,
    targets: ['contract'],
  },
  {
    id: 'contract.insuranceWaiverReason',
    label: '不投保風險評估及理由',
    section: 'contract',
    dataType: 'multiline',
    requirement: 'conditional',
    purpose: '避免僅勾選不投保而未留下風險評估及決策依據。',
    helpText: '選擇不要求保險時，請說明風險、替代控管措施及不投保理由。',
    legalBasis: pccServiceContractUrl,
    appliesWhen: insuranceWaiverReasonRequired,
    targets: ['contract'],
  },
  {
    id: 'contract.ipRights',
    label: '智慧財產權與成果使用',
    section: 'contract',
    dataType: 'multiline',
    requirement: 'conditional',
    purpose: '明定成果著作權、授權範圍、第三人素材及交付格式。',
    helpText: '若有報告、影像、設計或軟體成果，請說明機關可使用、修改及再授權的範圍。',
    legalBasis: pccServiceContractUrl,
    appliesWhen: serviceCase,
    targets: ['requirements', 'contract'],
  },
  {
    id: 'contract.confidentiality',
    label: '保密及個資／資訊安全',
    section: 'contract',
    dataType: 'multiline',
    requirement: 'conditional',
    purpose: '處理個資、未公開資料或資訊系統存取風險。',
    helpText: '若案件接觸個資、內部資料或系統帳號，應填資料範圍、保存期限、刪除及通報要求。',
    appliesWhen: sensitiveCase,
    targets: ['requirements', 'contract'],
  },
] satisfies readonly FieldDefinition[];

/** Convert a legacy display value (used by the existing writers) to the
 * stable v2 value stored in `ProcurementCase.fields`.  Unknown values are
 * returned unchanged so a human can see and resolve them in the review UI. */
export function toStableFieldValue(fieldId: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const definition = ordinaryServiceFieldRegistry.find((item) => item.id === fieldId);
  const candidate = value.trim();
  const byLegacy = definition?.options?.find((item) => item.legacyValue === candidate);
  return byLegacy?.value ?? value;
}

/** Convert a stable v2 value to the legacy display string expected by current
 * document writers.  Unknown values are returned unchanged. */
export function toLegacyFieldValue(fieldId: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const definition = ordinaryServiceFieldRegistry.find((item) => item.id === fieldId);
  const candidate = value.trim();
  const byStable = definition?.options?.find((item) => item.value === candidate);
  return byStable?.legacyValue ?? value;
}

// More explicit aliases for callers that only convert decision fields.
export const legacyToStableValue = toStableFieldValue;
export const stableToLegacyValue = toLegacyFieldValue;

export function getFieldDefinition(fieldId: string): FieldDefinition | undefined {
  return ordinaryServiceFieldRegistry.find((definition) => definition.id === fieldId);
}

export function getFieldDefinitions(section?: FieldDefinition['section']): FieldDefinition[] {
  return ordinaryServiceFieldRegistry.filter((definition) => !section || definition.section === section);
}

export function isFieldApplicable(definition: FieldDefinition, procurementCase: ProcurementCase): boolean {
  return definition.appliesWhen ? definition.appliesWhen(procurementCase) : true;
}

export function getLegacyFieldValue(
  procurementCase: ProcurementCase,
  definition: FieldDefinition,
): unknown {
  return fieldValue(procurementCase, definition.id, definition.legacyKey);
}

export function isFieldValuePresent(value: unknown): boolean {
  return hasValue(value);
}

export type OrdinaryServiceFieldId = (typeof ordinaryServiceFieldRegistry)[number]['id'];
export type OrdinaryServiceDecisionValue = (typeof SERVICE_DECISION_VALUES)[keyof typeof SERVICE_DECISION_VALUES];

export function isProcurementCategory(value: unknown): value is ProcurementCategory {
  return value === 'service' || value === 'goods' || value === 'construction' || value === 'unknown';
}
