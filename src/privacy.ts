import type { ProcurementCase, SecurityLevel } from './types';
import {
  analyzeProcurementWithGemini,
  generateProcurementDraftWithGemini,
  type GeminiAnalysisResult,
  type GeminiProcurementDraftResult,
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

const sanitizedContextKeys = new Set([
  'category',
  'description',
  'contractDuration',
  'deliverables',
  'paymentTerms',
  'acceptanceMethod',
]);

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`AI 外送欄位「${label}」格式不正確。`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`AI 外送欄位「${label}」過長。`);
  return normalized || undefined;
}

function normalizeSanitizedAIContext(context: SanitizedAIContext): SanitizedAIContext {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new Error('AI 外送內容格式不正確。');
  }
  const unknownKeys = Object.keys(context).filter((key) => !sanitizedContextKeys.has(key));
  if (unknownKeys.length) throw new Error(`AI 外送內容含有未允許欄位：${unknownKeys.join('、')}。`);
  if (!['unknown', 'service', 'goods', 'construction'].includes(context.category)) {
    throw new Error('AI 外送內容的採購類型不正確。');
  }
  if (typeof context.description !== 'string' || context.description.length > 50_000) {
    throw new Error('AI 外送內容的採購需求格式不正確或過長。');
  }
  if (!Array.isArray(context.deliverables) || context.deliverables.length > 50) {
    throw new Error('AI 外送內容的交付成果格式不正確或項目過多。');
  }
  const deliverables = context.deliverables.map((item) => {
    if (typeof item !== 'string' || item.length > 2_000) throw new Error('AI 外送內容的交付成果格式不正確或過長。');
    return item.trim();
  }).filter(Boolean);
  const normalized: SanitizedAIContext = {
    category: context.category,
    description: context.description.trim(),
    contractDuration: optionalText(context.contractDuration, '履約期間', 100),
    deliverables,
    paymentTerms: optionalText(context.paymentTerms, '付款條件', 5_000),
    acceptanceMethod: optionalText(context.acceptanceMethod, '驗收方式', 5_000),
  };
  const restricted = detectRestrictedText([
    normalized.description,
    normalized.contractDuration,
    ...normalized.deliverables,
    normalized.paymentTerms,
    normalized.acceptanceMethod,
  ].filter(Boolean).join('\n'));
  if (restricted.length) throw new Error('偵測到 RESTRICTED 內容，AI 外送已阻擋。');
  return normalized;
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

  return normalizeSanitizedAIContext({
    category: procurementCase.category,
    description: procurementCase.description,
    contractDuration:
      procurementCase.contractStart && procurementCase.contractEnd
        ? `${procurementCase.contractStart} ~ ${procurementCase.contractEnd}`
        : undefined,
    deliverables: [...procurementCase.deliverables],
    paymentTerms: procurementCase.paymentTerms || undefined,
    acceptanceMethod: procurementCase.acceptanceMethod || undefined,
  });
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
  return analyzeProcurementWithGemini(normalizeSanitizedAIContext(context), options.apiKey, options.model, options);
}

export async function externalDraftAIGateway(
  context: SanitizedAIContext,
  options: ExternalAIGatewayOptions,
): Promise<GeminiProcurementDraftResult> {
  return generateProcurementDraftWithGemini(normalizeSanitizedAIContext(context), options.apiKey, options.model, options);
}
