import type { ProcurementCategory } from './types';

export const PROCUREMENT_RULESET = {
  effectiveFrom: '2023-01-01',
  verifiedOn: '2026-08-27',
  smallProcurementMax: 150_000,
  announcementThreshold: 1_500_000,
  sources: {
    thresholds: 'https://www.pcc.gov.tw/content/index?eid=3950&lang=1&ltype=N&nn=E7BDAFCB081133B5&sms=53E09032BF601A56',
    procurementAct: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030057',
    belowAnnouncementRules: 'https://www.pcc.gov.tw/content/cp.aspx?n=C3B971E6865398D9',
  },
} as const;

export const PROCUREMENT_VALUES = {
  directSmall: '小額採購（逕洽廠商）',
  publicQuote: '公開取得書面報價或企劃書（採購法第49條）',
  openTender: '公開招標',
  selectiveTender: '選擇性招標（須符合採購法第20條）',
  restrictedTender: '限制性招標（須具採購法第22條法定事由）',
  lowestWithReserve: '最低標（訂有底價）',
  lowestWithoutReserve: '最低標（未訂底價）',
  referenceMostAdvantageous: '參考最有利標精神',
  mostAdvantageous: '最有利標（須依法核准）',
  quasiMostAdvantageous: '準用最有利標（須符合適用情形）',
  scoredLowest: '評分及格最低標',
  suitableSmall: '最符合需要（小額採購，價格須合理）',
  totalAward: '總價決標',
  itemAward: '分項決標',
  groupAward: '分組決標',
  quantityAward: '依數量決標（複數決標）',
  unitAward: '單價決標',
  otherAward: '其他（須於招標文件敘明）',
  totalPackage: '總包價法',
  unitPrice: '單價計算法',
  monthly: '按月計酬法',
  daily: '按日計酬法',
  hourly: '按時計酬法',
  costPlusFee: '服務成本加公費法',
} as const;

export type ProcurementAmountBand = 'unset' | 'small' | 'below-announcement' | 'announcement-or-above';

export interface GuidanceOption {
  value: string;
  label: string;
  description: string;
  legalBasis: string;
  requiresJustification?: boolean;
}

export interface ProcurementGuidanceInput {
  budget: number;
  category: ProcurementCategory;
  procurementMethod?: string;
  awardPrinciple?: string;
  awardMethod?: string;
  contractPriceMethod?: string;
}

export interface ProcurementGuidance {
  band: ProcurementAmountBand;
  bandLabel: string;
  bandSummary: string;
  methodOptions: GuidanceOption[];
  awardPrincipleOptions: GuidanceOption[];
  awardMethodOptions: GuidanceOption[];
  contractPriceMethodOptions: GuidanceOption[];
  recommended: {
    procurementMethod: string;
    procurementMethodReason: string;
    awardPrinciple: string;
    awardPrincipleReason: string;
    awardMethod: string;
    awardMethodReason: string;
    contractPriceMethod: string;
    contractPriceMethodReason: string;
  };
  warnings: string[];
}

const methodOptions = {
  directSmall: {
    value: PROCUREMENT_VALUES.directSmall,
    label: '小額採購（逕洽廠商）',
    description: '中央機關15萬元以下得不經公告程序逕洽廠商，免提供報價或企劃書；仍須確認價格合理且不得分批規避。',
    legalBasis: '中央機關未達公告金額採購招標辦法第5、6條',
  },
  publicQuote: {
    value: PROCUREMENT_VALUES.publicQuote,
    label: '公開取得書面報價或企劃書',
    description: '未達公告金額而逾15萬元的原則程序；公開取得三家以上報價或企劃書後，擇符合需要者比價或議價。',
    legalBasis: '政府採購法第49條；中央機關未達公告金額採購招標辦法第2至4條',
  },
  openTender: {
    value: PROCUREMENT_VALUES.openTender,
    label: '公開招標',
    description: '公告金額以上採購的原則方式，以公告邀請不特定廠商投標。',
    legalBasis: '政府採購法第18、19條',
  },
  selectiveTender: {
    value: PROCUREMENT_VALUES.selectiveTender,
    label: '選擇性招標（法定條件）',
    description: '僅適用經常性、審查費時、投標成本高、資格複雜或研究發展等法定情形。',
    legalBasis: '政府採購法第20條',
    requiresJustification: true,
  },
  restrictedTender: {
    value: PROCUREMENT_VALUES.restrictedTender,
    label: '限制性招標（法定例外）',
    description: '須有採購法第22條法定事由；未達公告金額案件亦須依中央或地方規定完成個案理由及必要核准。',
    legalBasis: '政府採購法第22條；中央機關未達公告金額採購招標辦法第2條',
    requiresJustification: true,
  },
} satisfies Record<string, GuidanceOption>;

const lowestWithReserve: GuidanceOption = {
  value: PROCUREMENT_VALUES.lowestWithReserve,
  label: '最低標（訂有底價）',
  description: '規格明確且同質性高時，以合格且在底價以內的最低標決標。',
  legalBasis: '政府採購法第46條、第52條第1項第1款',
};

const lowestWithoutReserve: GuidanceOption = {
  value: PROCUREMENT_VALUES.lowestWithoutReserve,
  label: '最低標（未訂底價）',
  description: '須敘明不訂底價理由，以合格、價格合理且在預算內的最低標決標。',
  legalBasis: '政府採購法第47條、第52條第1項第2款',
  requiresJustification: true,
};

const referenceMostAdvantageous: GuidanceOption = {
  value: PROCUREMENT_VALUES.referenceMostAdvantageous,
  label: '參考最有利標精神',
  description: '適用未達公告金額的公開取得企劃書案件；先載明評審項目與權重，擇最符合需要者議價或比價。不是正式最有利標。',
  legalBasis: '政府採購法第49條；工程會未達公告金額最有利標作業手冊',
  requiresJustification: true,
};

const formalMostAdvantageous: GuidanceOption = {
  value: PROCUREMENT_VALUES.mostAdvantageous,
  label: '最有利標',
  description: '依招標文件評審標準綜合評選，並應完成法定核准及評選程序。',
  legalBasis: '政府採購法第52條第1項第3款、第56條',
  requiresJustification: true,
};

const quasiMostAdvantageous: GuidanceOption = {
  value: PROCUREMENT_VALUES.quasiMostAdvantageous,
  label: '準用最有利標',
  description: '限制性招標是否得準用最有利標，取決於採購法第22條的具體適用款次與相關評選辦法。',
  legalBasis: '政府採購法第22條、第52條、第56條及相關評選辦法',
  requiresJustification: true,
};

const scoredLowest: GuidanceOption = {
  value: PROCUREMENT_VALUES.scoredLowest,
  label: '評分及格最低標',
  description: '先評分達及格標準，再開價格標並以最低標決標；評分不得納入價格。',
  legalBasis: '政府採購法施行細則第64條之2',
  requiresJustification: true,
};

const suitableSmall: GuidanceOption = {
  value: PROCUREMENT_VALUES.suitableSmall,
  label: '最符合需要（小額採購）',
  description: '小額採購仍應確認需求符合、價格公平合理並留下內部核准紀錄。',
  legalBasis: '中央機關未達公告金額採購招標辦法第5條；政府採購法第6條',
};

const awardMethodOptions: GuidanceOption[] = [
  { value: PROCUREMENT_VALUES.totalAward, label: '總價決標', description: '全部項目由同一廠商以總價決標，適合工作範圍與成果可明確定義的案件。', legalBasis: '工程會投標須知範本決標方式' },
  { value: PROCUREMENT_VALUES.itemAward, label: '分項決標', description: '各工作項目可分別決標，招標文件須清楚劃分項目及責任。', legalBasis: '工程會投標須知範本決標方式' },
  { value: PROCUREMENT_VALUES.groupAward, label: '分組決標', description: '將可獨立履約的項目組成數組分別決標。', legalBasis: '工程會投標須知範本決標方式' },
  { value: PROCUREMENT_VALUES.quantityAward, label: '依數量決標（複數決標）', description: '須預先載明數量上下限、組合與競爭原則，不得用以規避採購金額門檻。', legalBasis: '政府採購法第52條第1項第4款；施行細則第65條', requiresJustification: true },
  { value: PROCUREMENT_VALUES.unitAward, label: '單價決標', description: '數量尚無法完全確定、依實際數量結算時使用，須有明確估算數量與上限。', legalBasis: '工程會投標須知範本決標方式' },
  { value: PROCUREMENT_VALUES.otherAward, label: '其他（人工敘明）', description: '僅在上述方式均不適合時使用，並須在招標文件完整敘明。', legalBasis: '工程會投標須知範本決標方式', requiresJustification: true },
];

const contractPriceOptions = {
  totalPackage: { value: PROCUREMENT_VALUES.totalPackage, label: '總包價法', description: '以完整履約成果作為總價，適合範圍、交付成果及驗收標準明確的案件。', legalBasis: '工程會勞務採購契約範本' },
  unitPrice: { value: PROCUREMENT_VALUES.unitPrice, label: '單價計算法', description: '依實際完成數量乘以契約單價計價，須明定項目、單位、估算量與上限。', legalBasis: '工程會勞務採購契約範本' },
  monthly: { value: PROCUREMENT_VALUES.monthly, label: '按月計酬法', description: '適合持續性、每月工作內容與驗收標準可明確定義的勞務。', legalBasis: '工程會勞務採購契約範本' },
  daily: { value: PROCUREMENT_VALUES.daily, label: '按日計酬法', description: '依實際工作日計酬，須定義工時、工作紀錄、成果及上限。', legalBasis: '工程會勞務採購契約範本' },
  hourly: { value: PROCUREMENT_VALUES.hourly, label: '按時計酬法', description: '依實際工時計酬，須有核實機制、成果要求及總額上限。', legalBasis: '工程會勞務採購契約範本' },
  costPlusFee: { value: PROCUREMENT_VALUES.costPlusFee, label: '服務成本加公費法', description: '僅適用成本與公費可合理查核的專業服務，須另確認費用計算規定。', legalBasis: '機關委託專業服務廠商評選及計費辦法', requiresJustification: true },
} satisfies Record<string, GuidanceOption>;

export function getProcurementAmountBand(budget: number): ProcurementAmountBand {
  if (!Number.isFinite(budget) || budget <= 0) return 'unset';
  if (budget <= PROCUREMENT_RULESET.smallProcurementMax) return 'small';
  if (budget < PROCUREMENT_RULESET.announcementThreshold) return 'below-announcement';
  return 'announcement-or-above';
}

function optionsForBand(band: ProcurementAmountBand): GuidanceOption[] {
  if (band === 'small') return [methodOptions.directSmall, methodOptions.publicQuote, methodOptions.restrictedTender];
  if (band === 'below-announcement') return [methodOptions.publicQuote, methodOptions.restrictedTender];
  if (band === 'announcement-or-above') return [methodOptions.openTender, methodOptions.selectiveTender, methodOptions.restrictedTender];
  return [];
}

function principlesForMethod(method: string): GuidanceOption[] {
  if (method.includes('小額採購')) return [suitableSmall, lowestWithReserve, lowestWithoutReserve];
  if (method.includes('公開取得')) return [lowestWithReserve, lowestWithoutReserve, referenceMostAdvantageous, scoredLowest];
  if (method.includes('限制性')) return [lowestWithReserve, lowestWithoutReserve, quasiMostAdvantageous, formalMostAdvantageous, scoredLowest];
  if (method.includes('公開招標') || method.includes('選擇性')) {
    return [lowestWithReserve, lowestWithoutReserve, formalMostAdvantageous, scoredLowest];
  }
  return [];
}

function contractOptionsForCategory(category: ProcurementCategory): GuidanceOption[] {
  if (category === 'service') {
    return [
      contractPriceOptions.totalPackage,
      contractPriceOptions.unitPrice,
      contractPriceOptions.monthly,
      contractPriceOptions.daily,
      contractPriceOptions.hourly,
      contractPriceOptions.costPlusFee,
    ];
  }
  if (category === 'goods' || category === 'construction') {
    return [contractPriceOptions.totalPackage, contractPriceOptions.unitPrice];
  }
  return [];
}

function formatMoney(value: number) {
  return `NT$ ${Math.round(value).toLocaleString('zh-TW')}`;
}

export function buildProcurementGuidance(input: ProcurementGuidanceInput): ProcurementGuidance {
  const band = getProcurementAmountBand(input.budget);
  const methods = optionsForBand(band);
  const recommendedMethod = band === 'small'
    ? PROCUREMENT_VALUES.directSmall
    : band === 'below-announcement'
      ? PROCUREMENT_VALUES.publicQuote
      : band === 'announcement-or-above'
        ? PROCUREMENT_VALUES.openTender
        : '';
  const effectiveMethod = input.procurementMethod?.trim() || recommendedMethod;
  const principleOptions = principlesForMethod(effectiveMethod);

  let recommendedPrinciple = '';
  let recommendedPrincipleReason = '請先確認採購金額與招標方式。';
  if (effectiveMethod.includes('小額採購')) {
    recommendedPrinciple = PROCUREMENT_VALUES.suitableSmall;
    recommendedPrincipleReason = '小額採購仍須選擇符合需要的廠商並確認價格合理。';
  } else if (effectiveMethod.includes('公開取得')) {
    recommendedPrinciple = input.category === 'service'
      ? PROCUREMENT_VALUES.referenceMostAdvantageous
      : PROCUREMENT_VALUES.lowestWithReserve;
    recommendedPrincipleReason = input.category === 'service'
      ? '勞務成果通常包含品質差異，可先考慮參考最有利標精神；若規格完全同質，仍可改選最低標。'
      : '規格可明確量化時，最低標通常較直接；如品質差異重大，應由承辦人改選合適程序。';
  } else if (effectiveMethod.includes('限制性')) {
    recommendedPrincipleReason = '限制性招標的決標原則取決於採購法第22條實際款次與核准內容，系統不自動推薦。';
  } else if (effectiveMethod) {
    recommendedPrinciple = PROCUREMENT_VALUES.lowestWithReserve;
    recommendedPrincipleReason = input.category === 'service'
      ? '先以最低標作為一般選項；若屬公告金額以上的專業、技術、資訊、社福或文創服務，依法以不訂底價最有利標為原則，請人工改選。'
      : '規格明確且同質時可採訂有底價最低標；異質或品質導向案件應評估最有利標或評分及格最低標。';
  }

  const warnings = [
    '本規則以中央機關現行門檻為基準；地方機關應先確認直轄市或縣（市）另定規則。',
    '採購金額應包含後續擴充等預計給付，不得分批辦理以規避法定門檻。',
  ];
  if (band === 'unset') warnings.unshift('請先填寫大於0的預算金額，系統才能判斷適用級距。');
  if (input.procurementMethod?.trim() && !methods.some((option) => option.value === input.procurementMethod)) {
    warnings.unshift(`目前招標方式「${input.procurementMethod}」不在此金額級距的標準選項內，請重新確認。`);
  }
  if (input.awardPrinciple?.trim() && !principleOptions.some((option) => option.value === input.awardPrinciple)) {
    warnings.unshift(`目前決標原則「${input.awardPrinciple}」與所選招標方式不相容或尚未完成標準化，請重新確認。`);
  }
  if (effectiveMethod.includes('限制性') || effectiveMethod.includes('選擇性')) {
    warnings.unshift('此招標方式不是一般預設路徑，須記錄具體法定事由、簽核與必要核准。');
  }

  const bandLabel = band === 'small'
    ? '中央機關小額採購'
    : band === 'below-announcement'
      ? '逾小額、未達公告金額'
      : band === 'announcement-or-above'
        ? '公告金額以上'
        : '尚未判斷金額級距';
  const bandSummary = band === 'small'
    ? `${formatMoney(input.budget)}：15萬元以下，可依小額採購規定辦理。`
    : band === 'below-announcement'
      ? `${formatMoney(input.budget)}：逾15萬元且未達150萬元，原則依採購法第49條公開取得報價或企劃書。`
      : band === 'announcement-or-above'
        ? `${formatMoney(input.budget)}：達150萬元，原則公開招標；選擇性或限制性招標須符合法定條件。`
        : '填寫預算後，系統會依有效門檻顯示可選程序。';

  const contractOptions = contractOptionsForCategory(input.category);
  return {
    band,
    bandLabel,
    bandSummary,
    methodOptions: methods,
    awardPrincipleOptions: principleOptions,
    awardMethodOptions,
    contractPriceMethodOptions: contractOptions,
    recommended: {
      procurementMethod: recommendedMethod,
      procurementMethodReason: band === 'small'
        ? '中央機關15萬元以下得逕洽廠商；仍須價格合理且不得分批規避。'
        : band === 'below-announcement'
          ? '採購法第49條要求公開取得三家以上廠商書面報價或企劃書；法定例外才可改採限制性招標。'
          : band === 'announcement-or-above'
            ? '公告金額以上依採購法第19條以公開招標為原則。'
            : '請先填寫預算金額。',
      awardPrinciple: recommendedPrinciple,
      awardPrincipleReason: recommendedPrincipleReason,
      awardMethod: PROCUREMENT_VALUES.totalAward,
      awardMethodReason: '工作範圍與成果由單一廠商整體負責時，總價決標最容易維持責任與文件一致；可依實際可分性改選其他方式。',
      contractPriceMethod: input.category === 'unknown' ? '' : PROCUREMENT_VALUES.totalPackage,
      contractPriceMethodReason: input.category === 'service'
        ? '成果與驗收標準可明確界定時先建議總包價法；持續性或數量不確定者可改選按月或單價計算。'
        : '標的與數量明確時先建議總包價法；依實作數量結算時改選單價計算法。',
    },
    warnings,
  };
}

export function isGuidanceOptionValue(value: string | undefined, options: GuidanceOption[]) {
  const normalized = value?.trim();
  return Boolean(normalized && options.some((option) => option.value === normalized));
}
