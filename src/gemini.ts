import type { SanitizedAIContext } from './privacy';

const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

/** Google-maintained fallback for future model-name changes. */
export const GEMINI_FLASH_LATEST_ALIAS = 'gemini-flash-latest';

interface GeminiModelRecord {
  name?: string;
  baseModelId?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
  status?: string;
  lifecycleState?: string;
  modelStatus?: {
    modelStage?: string;
  };
}

interface GeminiModelsResponse {
  models?: GeminiModelRecord[];
  nextPageToken?: string;
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
    finishMessage?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
    blockReasonMessage?: string;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
}

interface GeminiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export interface GeminiModelSelection {
  selectedModel: string;
  compatibleStableModels: string[];
  usedAliasFallback: boolean;
}

export interface GeminiAnalysisResult {
  text: string;
  requestedModel: string;
  resolvedModel: string;
  totalTokenCount?: number;
}

export interface GeminiRequestOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export class GeminiApiError extends Error {
  readonly status: number;
  readonly apiStatus?: string;
  readonly detail?: string;

  constructor(message: string, status = 0, apiStatus?: string, detail?: string) {
    super(message);
    this.name = 'GeminiApiError';
    this.status = status;
    this.apiStatus = apiStatus;
    this.detail = detail;
  }
}

function requireApiKey(apiKey: string) {
  const normalized = apiKey.trim();
  if (!normalized) throw new GeminiApiError('請先輸入 Gemini API Key。');
  return normalized;
}

function modelId(model: GeminiModelRecord) {
  return (model.baseModelId || model.name || '').replace(/^models\//, '').trim();
}

function stableFlashVersion(id: string): number[] | undefined {
  const match = id.match(/^gemini-(\d+(?:\.\d+)*)-flash$/i);
  return match?.[1].split('.').map(Number);
}

function compareVersionsDescending(left: number[], right: number[]) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Selects the highest numeric, stable, general-purpose Flash model returned by
 * models.list. Image, Live, TTS, Lite, preview and experimental variants do not
 * match the stable ID pattern. If Google changes the naming scheme entirely,
 * the official latest alias remains the safe fallback.
 */
export function selectLatestStableFlashModel(models: GeminiModelRecord[]): GeminiModelSelection {
  const compatible = new Map<string, number[]>();

  for (const model of models) {
    if (!model.supportedGenerationMethods?.includes('generateContent')) continue;
    const lifecycle = [model.status, model.lifecycleState, model.modelStatus?.modelStage]
      .filter(Boolean)
      .join(' ')
      .toUpperCase();
    if (/(PREVIEW|EXPERIMENTAL|LEGACY|DEPRECATED|RETIRED)/.test(lifecycle)) continue;
    const id = modelId(model);
    const version = stableFlashVersion(id);
    if (version) compatible.set(id, version);
  }

  const compatibleStableModels = [...compatible.entries()]
    .sort((left, right) => compareVersionsDescending(left[1], right[1]))
    .map(([id]) => id);

  return {
    selectedModel: compatibleStableModels[0] ?? GEMINI_FLASH_LATEST_ALIAS,
    compatibleStableModels,
    usedAliasFallback: compatibleStableModels.length === 0,
  };
}

function friendlyApiError(status: number, detail: string) {
  if (status === 400) return `Gemini 拒絕此請求。請確認 API Key、模型與輸入內容。${detail ? `（${detail}）` : ''}`;
  if (status === 401 || status === 403) return 'Gemini API Key 無效、權限不足，或尚未啟用 Gemini API。';
  if (status === 429) return 'Gemini API 配額或速率已達上限，請稍後再試或檢查帳務設定。';
  if (status >= 500) return 'Gemini 服務暫時無法使用，請稍後再試。';
  return `Gemini API 呼叫失敗（HTTP ${status}）。${detail}`.trim();
}

async function geminiFetchJson<T>(
  url: string,
  apiKey: string,
  init: RequestInit,
  options: GeminiRequestOptions,
): Promise<T> {
  const normalizedKey = requireApiKey(apiKey);
  const headers = new Headers(init.headers);
  headers.set('x-goog-api-key', normalizedKey);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      ...init,
      headers,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new GeminiApiError('Gemini 呼叫已取消。');
    }
    throw new GeminiApiError('無法連線到 Gemini API；請檢查網路、瀏覽器擴充功能或跨網域限制。');
  }

  if (!response.ok) {
    let detail = '';
    let apiStatus = '';
    try {
      const payload = await response.json() as GeminiErrorPayload;
      detail = payload.error?.message?.replaceAll(normalizedKey, '[已遮蔽]') ?? '';
      apiStatus = payload.error?.status ?? '';
    } catch {
      // Do not echo arbitrary response bodies because they may contain request data.
    }
    throw new GeminiApiError(friendlyApiError(response.status, detail), response.status, apiStatus, detail);
  }

  try {
    return await response.json() as T;
  } catch {
    throw new GeminiApiError('Gemini API 回傳了無法解析的資料。', response.status);
  }
}

export async function listGeminiModels(
  apiKey: string,
  options: GeminiRequestOptions = {},
): Promise<GeminiModelRecord[]> {
  requireApiKey(apiKey);
  const models: GeminiModelRecord[] = [];
  const seenTokens = new Set<string>();
  let pageToken = '';

  while (true) {
    const url = new URL(`${GEMINI_API_ROOT}/models`);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const payload = await geminiFetchJson<GeminiModelsResponse>(url.toString(), apiKey, { method: 'GET' }, options);
    if (!Array.isArray(payload.models)) throw new GeminiApiError('Gemini 模型清單格式不正確。');
    models.push(...payload.models);

    const nextPageToken = payload.nextPageToken?.trim() ?? '';
    if (!nextPageToken) return models;
    if (seenTokens.has(nextPageToken)) throw new GeminiApiError('Gemini 模型清單分頁發生循環，已停止讀取。');
    seenTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }
}

export async function validateGeminiApiKey(
  apiKey: string,
  options: GeminiRequestOptions = {},
): Promise<GeminiModelSelection> {
  const models = await listGeminiModels(apiKey, options);
  return selectLatestStableFlashModel(models);
}

function buildProcurementPrompt(context: SanitizedAIContext) {
  return [
    '請檢查以下已去除機敏資訊的採購案件資料。',
    '只根據提供內容提出建議，不得自行猜測底價、保額、法定招標方式、決標原則或不存在的事實。',
    '請用繁體中文依序輸出：一、已知資料摘要；二、缺漏欄位；三、跨文件一致性風險；四、需承辦人確認事項。',
    '',
    '--- 已去敏感案件資料（JSON）---',
    JSON.stringify(context, null, 2),
    '--- 資料結束 ---',
  ].join('\n');
}

function extractGeminiText(payload: GeminiGenerateResponse) {
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .filter(Boolean)
    .join('\n')
    .trim();

  if (text) return text;
  const blocked = payload.promptFeedback?.blockReason;
  if (blocked) {
    throw new GeminiApiError(`Gemini 因安全政策未處理此內容（${blocked}）。`);
  }
  const finishMessage = payload.candidates?.[0]?.finishMessage;
  throw new GeminiApiError(finishMessage || 'Gemini 未回傳可顯示的文字內容。');
}

function isUnavailableModelError(error: unknown) {
  return error instanceof GeminiApiError
    && (
      error.status === 404
      || error.apiStatus === 'NOT_FOUND'
      || (error.status === 400 && /(?:model[^\n]*(?:not found|unknown|unsupported)|找不到[^\n]*模型)/i.test(error.detail ?? ''))
    );
}

export async function analyzeProcurementWithGemini(
  context: SanitizedAIContext,
  apiKey: string,
  selectedModel: string,
  options: GeminiRequestOptions = {},
): Promise<GeminiAnalysisResult> {
  requireApiKey(apiKey);
  const requestedModels = [...new Set([
    selectedModel.trim() || GEMINI_FLASH_LATEST_ALIAS,
    GEMINI_FLASH_LATEST_ALIAS,
  ])];

  let lastUnavailableError: unknown;
  for (const model of requestedModels) {
    try {
      const url = `${GEMINI_API_ROOT}/models/${encodeURIComponent(model)}:generateContent`;
      const payload = await geminiFetchJson<GeminiGenerateResponse>(url, apiKey, {
        method: 'POST',
        body: JSON.stringify({
          system_instruction: {
            parts: [{
              text: '你是臺灣政府採購文件檢核助理。你的輸出只供承辦人審查，不取代採購、法制、主計或其他專業判斷。',
            }],
          },
          contents: [{
            role: 'user',
            parts: [{ text: buildProcurementPrompt(context) }],
          }],
          generationConfig: {
            maxOutputTokens: 2048,
          },
        }),
      }, options);

      return {
        text: extractGeminiText(payload),
        requestedModel: model,
        resolvedModel: payload.modelVersion || model,
        totalTokenCount: payload.usageMetadata?.totalTokenCount,
      };
    } catch (error) {
      if (isUnavailableModelError(error) && model !== requestedModels.at(-1)) {
        lastUnavailableError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastUnavailableError ?? new GeminiApiError('找不到可使用的 Gemini Flash 模型。');
}
