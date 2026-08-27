import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GEMINI_FLASH_LATEST_ALIAS,
  analyzeProcurementWithGemini,
  generateProcurementDraftWithGemini,
  listGeminiModels,
  parseGeminiProcurementDraft,
  selectLatestStableFlashModel,
  validateGeminiApiKey,
} from '../src/gemini.ts';
import { buildSanitizedAIContext, externalDraftAIGateway } from '../src/privacy.ts';

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

test('structured draft generation sends only the allowlisted context and never requests prices', async () => {
  const context = {
    category: 'service' as const,
    description: '辦理兩場防災演練並提交成果報告',
    deliverables: [],
    paymentTerms: undefined,
    acceptanceMethod: undefined,
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = String(init?.body);
    assert.match(url, /models\/gemini-3\.7-flash:generateContent$/);
    assert.equal(url.includes(apiKey), false);
    assert.equal(headers.get('x-goog-api-key'), apiKey);
    assert.equal(body.includes(apiKey), false);
    assert.equal(body.includes('980000'), false);

    const requestBody = JSON.parse(body) as {
      generationConfig?: {
        temperature?: unknown;
        topP?: unknown;
        topK?: unknown;
        responseFormat?: { text?: { mimeType?: string; schema?: Record<string, unknown> } };
      };
    };
    assert.equal(requestBody.generationConfig?.temperature, undefined);
    assert.equal(requestBody.generationConfig?.topP, undefined);
    assert.equal(requestBody.generationConfig?.topK, undefined);
    assert.equal(requestBody.generationConfig?.responseFormat?.text?.mimeType, 'application/json');
    assert.equal(requestBody.generationConfig?.responseFormat?.text?.schema?.additionalProperties, false);
    assert.match(body, /不得產生或推算/);
    assert.match(body, /辦理兩場防災演練/);

    return jsonResponse({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              paymentTerms: '完成全部成果並驗收合格後付款。',
              acceptanceMethod: '依契約逐項核對演練紀錄與成果報告。',
              vendorQualification: '依法設立且營業項目與本案履約內容相關之廠商。',
              deliverables: ['演練執行紀錄', '成果報告'],
              pricingItems: [
                { description: '防災演練', quantity: 2, unit: '場', note: '場次仍須由承辦人確認。' },
                { description: '成果報告', quantity: 1, unit: '式', note: '' },
              ],
              warnings: ['保險種類與額度須由承辦人依風險確認。'],
            }),
          }],
        },
      }],
      modelVersion: 'gemini-3.7-flash-001',
      usageMetadata: { totalTokenCount: 456 },
    });
  };

  const result = await generateProcurementDraftWithGemini(
    context,
    apiKey,
    'gemini-3.7-flash',
    { fetchImpl },
  );
  assert.equal(result.resolvedModel, 'gemini-3.7-flash-001');
  assert.equal(result.totalTokenCount, 456);
  assert.equal(result.draft.pricingItems[0].quantity, 2);
  assert.equal('estimatedUnitPrice' in result.draft.pricingItems[0], false);
});

test('structured draft parser trims and deduplicates safe editable fields', () => {
  const parsed = parseGeminiProcurementDraft(`\`\`\`json
  {
    "paymentTerms": " 驗收合格後付款 ",
    "acceptanceMethod": "書面及現場驗收",
    "vendorQualification": "依法設立之相關廠商",
    "deliverables": ["成果報告", " 成果報告 ", "演練紀錄"],
    "pricingItems": [
      {"description":"成果報告","quantity":null,"unit":"式","note":"確認份數"},
      {"description":" 成果報告 ","quantity":1,"unit":"式","note":"重複"}
    ],
    "warnings": []
  }
  \`\`\``);

  assert.deepEqual(parsed.deliverables, ['成果報告', '演練紀錄']);
  assert.equal(parsed.pricingItems.length, 1);
  assert.equal(parsed.pricingItems[0].quantity, undefined);
  assert.equal(parsed.paymentTerms, '驗收合格後付款');
});

test('structured draft parser rejects price fields and invalid quantities', () => {
  const base = {
    paymentTerms: '驗收後付款',
    acceptanceMethod: '書面驗收',
    vendorQualification: '依法設立之廠商',
    deliverables: ['成果報告'],
    warnings: [],
  };
  assert.throws(() => parseGeminiProcurementDraft(JSON.stringify({
    ...base,
    pricingItems: [{
      description: '成果報告',
      quantity: 1,
      unit: '式',
      note: '',
      estimatedUnitPrice: 980000,
    }],
  })), /未預期欄位/);
  assert.throws(() => parseGeminiProcurementDraft(JSON.stringify({
    ...base,
    pricingItems: [{ description: '成果報告', quantity: -1, unit: '式', note: '' }],
  })), /數量不正確/);
});

test('draft privacy gateway rejects runtime fields outside the explicit allowlist', async () => {
  let fetched = false;
  const fetchImpl: typeof fetch = async () => {
    fetched = true;
    return jsonResponse({});
  };
  const unsafeContext = {
    category: 'service' as const,
    description: '辦理教育訓練',
    deliverables: [],
    budget: 980000,
  };

  await assert.rejects(
    () => externalDraftAIGateway(unsafeContext, {
      apiKey,
      model: 'gemini-3.7-flash',
      fetchImpl,
    }),
    /未允許欄位.*budget/,
  );
  assert.equal(fetched, false);
});
