import type { ProcurementCase, SecurityLevel } from './types';
import {
  analyzeProcurementWithGemini,
  type GeminiAnalysisResult,
  type GeminiRequestOptions,
} from './gemini.ts';

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

  const combined = [
    procurementCase.description,
    procurementCase.paymentTerms,
    procurementCase.acceptanceMethod,
    ...procurementCase.deliverables,
  ].join('\n');
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

export interface ExternalAIGatewayOptions extends GeminiRequestOptions {
  apiKey: string;
  model: string;
}

// 重要：所有外部 AI 呼叫只接受 SanitizedAIContext，禁止傳 ProcurementCase。
export async function externalAIGateway(
  context: SanitizedAIContext,
  options: ExternalAIGatewayOptions,
): Promise<GeminiAnalysisResult> {
  return analyzeProcurementWithGemini(context, options.apiKey, options.model, options);
}
