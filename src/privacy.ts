import type { ProcurementCase, SecurityLevel } from './types';

export interface SanitizedAIContext {
  category: ProcurementCase['category'];
  description: string;
  contractDuration?: string;
  deliverables: string[];
  paymentTerms?: string;
  acceptanceMethod?: string;
}

const restrictedPatterns: RegExp[] = [
  /底價/g,
  /建議底價/g,
  /評選委員/g,
  /身分證字號/g,
  /廠商報價/g,
  /議價內容/g,
  /內部簽核/g,
];

export function detectRestrictedText(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of restrictedPatterns) {
    if (pattern.test(text)) hits.push(pattern.source);
    pattern.lastIndex = 0;
  }
  return hits;
}

export function canUseExternalAI(level: SecurityLevel): boolean {
  return level === 'PUBLIC' || level === 'INTERNAL';
}

export function buildSanitizedAIContext(procurementCase: ProcurementCase): SanitizedAIContext {
  if (!canUseExternalAI(procurementCase.securityLevel)) {
    throw new Error('此案件安全等級禁止使用外部 LLM。');
  }

  const combined = [procurementCase.description, procurementCase.paymentTerms, procurementCase.acceptanceMethod].join('\n');
  const restricted = detectRestrictedText(combined);
  if (restricted.length > 0 || procurementCase.reservePrice !== undefined) {
    throw new Error('偵測到 RESTRICTED 內容，AI 外送已阻擋。');
  }

  return {
    category: procurementCase.category,
    description: procurementCase.description,
    contractDuration:
      procurementCase.contractStart && procurementCase.contractEnd
        ? `${procurementCase.contractStart} ~ ${procurementCase.contractEnd}`
        : undefined,
    deliverables: procurementCase.deliverables,
    paymentTerms: procurementCase.paymentTerms || undefined,
    acceptanceMethod: procurementCase.acceptanceMethod || undefined,
  };
}

// 重要：未來所有外部 AI 呼叫都必須只接受 SanitizedAIContext，禁止傳 ProcurementCase。
export async function externalAIGateway(_context: SanitizedAIContext): Promise<never> {
  throw new Error('外部 AI 預設關閉。需由管理者設定 Provider 後才可啟用。');
}
