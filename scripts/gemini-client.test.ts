import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GEMINI_FLASH_LATEST_ALIAS,
  analyzeProcurementWithGemini,
  listGeminiModels,
  selectLatestStableFlashModel,
  validateGeminiApiKey,
} from '../src/gemini.ts';
import { buildSanitizedAIContext } from '../src/privacy.ts';

const apiKey = 'test-secret-api-key';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('selects the newest stable general-purpose Flash model', () => {
  const selection = selectLatestStableFlashModel([
    { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4-flash-preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-9.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-8-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-99-flash', status: 'DEPRECATED', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-10-flash', supportedGenerationMethods: ['embedContent'] },
  ]);

  assert.equal(selection.selectedModel, 'gemini-3.7-flash');
  assert.deepEqual(selection.compatibleStableModels, ['gemini-3.7-flash', 'gemini-3.6-flash']);
  assert.equal(selection.usedAliasFallback, false);
});

test('falls back to the official latest alias if naming cannot be recognized', () => {
  const selection = selectLatestStableFlashModel([
    { name: 'models/future-flash-workhorse', supportedGenerationMethods: ['generateContent'] },
  ]);

  assert.equal(selection.selectedModel, GEMINI_FLASH_LATEST_ALIAS);
  assert.equal(selection.usedAliasFallback, true);
});

test('lists all model pages and sends the key only in the header', async () => {
  const requestedUrls: string[] = [];
  let calls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requestedUrls.push(url);
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), apiKey);
    assert.equal(url.includes(apiKey), false);
    calls += 1;
    if (calls === 1) {
      return jsonResponse({
        models: [{ name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }],
        nextPageToken: 'page-two',
      });
    }
    assert.match(url, /pageToken=page-two/);
    return jsonResponse({
      models: [{ name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] }],
    });
  };

  const models = await listGeminiModels(apiKey, { fetchImpl });
  assert.equal(models.length, 2);
  assert.equal(requestedUrls.length, 2);
});

test('blank API key stops before fetch', async () => {
  let fetched = false;
  const fetchImpl: typeof fetch = async () => {
    fetched = true;
    return jsonResponse({ models: [] });
  };

  await assert.rejects(() => validateGeminiApiKey('   ', { fetchImpl }), /請先輸入/);
  assert.equal(fetched, false);
});

test('generation sends only sanitized context and reports the resolved model', async () => {
  const context = {
    category: 'service' as const,
    description: '辦理教育訓練',
    deliverables: ['成果報告'],
    paymentTerms: '驗收後付款',
    acceptanceMethod: '書面驗收',
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = String(init?.body);
    assert.match(url, /models\/gemini-3\.7-flash:generateContent$/);
    assert.equal(url.includes(apiKey), false);
    assert.equal(headers.get('x-goog-api-key'), apiKey);
    assert.equal(body.includes(apiKey), false);
    const requestBody = JSON.parse(body) as {
      generationConfig?: Record<string, unknown>;
    };
    assert.equal(requestBody.generationConfig?.temperature, undefined);
    assert.equal(requestBody.generationConfig?.topP, undefined);
    assert.equal(requestBody.generationConfig?.topK, undefined);
    assert.equal(body.includes('辦理教育訓練'), true);
    assert.equal(body.includes('內部備註'), false);
    return jsonResponse({
      candidates: [{ content: { parts: [{ text: '缺漏：保險內容待確認。' }] } }],
      modelVersion: 'gemini-3.7-flash-001',
      usageMetadata: { totalTokenCount: 123 },
    });
  };

  const result = await analyzeProcurementWithGemini(context, apiKey, 'gemini-3.7-flash', { fetchImpl });
  assert.equal(result.text, '缺漏：保險內容待確認。');
  assert.equal(result.resolvedModel, 'gemini-3.7-flash-001');
  assert.equal(result.totalTokenCount, 123);
});

test('an unavailable selected model retries the official latest alias', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    calls += 1;
    if (calls === 1) return jsonResponse({ error: { message: 'model not found' } }, 404);
    assert.match(String(input), /models\/gemini-flash-latest:generateContent$/);
    return jsonResponse({
      candidates: [{ content: { parts: [{ text: 'OK' }] } }],
      modelVersion: 'gemini-future-flash',
    });
  };

  const result = await analyzeProcurementWithGemini({
    category: 'service',
    description: '測試',
    deliverables: [],
  }, apiKey, 'gemini-3.7-flash', { fetchImpl });

  assert.equal(calls, 2);
  assert.equal(result.requestedModel, GEMINI_FLASH_LATEST_ALIAS);
});

test('ordinary HTTP 400 errors do not cause a second AI request', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return jsonResponse({ error: { status: 'INVALID_ARGUMENT', message: 'malformed generation config' } }, 400);
  };

  await assert.rejects(() => analyzeProcurementWithGemini({
    category: 'service',
    description: '測試',
    deliverables: [],
  }, apiKey, 'gemini-3.7-flash', { fetchImpl }), /拒絕此請求/);
  assert.equal(calls, 1);
});

test('API errors never echo the key', async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse({
    error: { message: `permission denied for ${apiKey}` },
  }, 403);

  await assert.rejects(
    () => listGeminiModels(apiKey, { fetchImpl }),
    (error: unknown) => error instanceof Error && !error.message.includes(apiKey),
  );
});

test('restricted text inside deliverables is blocked by the privacy gate', () => {
  assert.throws(() => buildSanitizedAIContext({
    id: 'case-1',
    title: '測試案',
    agency: '測試機關',
    category: 'service',
    budget: 100,
    description: '一般需求',
    paymentTerms: '',
    acceptanceMethod: '',
    deliverables: ['底價分析表'],
    vendorQualification: '',
    internalNotes: '',
    securityLevel: 'PUBLIC',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }), /RESTRICTED/);
});
