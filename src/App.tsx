import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCrossDocumentConsistencyReport } from './consistency';
import { deleteCase, listCases, upsertCase } from './db';
import { exportCaseDocx, exportCaseJson } from './export';
import { buildAllTemplateMappingPreviews } from './mapping';
import { completenessScore, evaluateCase } from './rules';
import { buildSanitizedAIContext, externalAIGateway } from './privacy';
import {
  validateGeminiApiKey,
  type GeminiAnalysisResult,
  type GeminiModelSelection,
} from './gemini';
import { formatRocDate, getTemplateArchive, getTemplateObservation, getTemplateSyncStatus, pccTemplateIndex } from './pcc';
import { templateRegistry } from './templates';
import { exportTenderInstructionsDraft } from './template-writer';
import { exportServiceContractDraft } from './service-contract-writer';
import { exportServiceRequirementsDraft } from './requirements-writer';
import type { PricingItem, ProcurementCase, ProcurementCategory, SecurityLevel } from './types';

function newCase(): ProcurementCase {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: '',
    agency: '',
    category: 'unknown',
    budget: 0,
    description: '',
    paymentTerms: '',
    acceptanceMethod: '',
    deliverables: [],
    pricingItems: [],
    vendorQualification: '',
    procurementMethod: '',
    awardPrinciple: '',
    awardMethod: '',
    bidBond: '',
    performanceBond: '',
    contractPriceMethod: '',
    internalNotes: '',
    securityLevel: 'INTERNAL',
    createdAt: now,
    updatedAt: now,
  };
}

const categoryNames: Record<ProcurementCategory, string> = {
  unknown: '尚未判斷',
  service: '勞務',
  goods: '財物',
  construction: '工程',
};

const securityNames: Record<SecurityLevel, string> = {
  PUBLIC: '公開',
  INTERNAL: '一般內部',
  SENSITIVE: '敏感',
  RESTRICTED: '高度敏感',
};

const syncLabels = {
  current: '已同步',
  candidate: '有新版待確認',
  untracked: '未追蹤',
} as const;

function pricingSubtotal(item: PricingItem) {
  if (item.quantity === undefined || item.estimatedUnitPrice === undefined) return undefined;
  return item.quantity * item.estimatedUnitPrice;
}

export default function App() {
  const [current, setCurrent] = useState<ProcurementCase>(newCase());
  const [cases, setCases] = useState<ProcurementCase[]>([]);
  const [saved, setSaved] = useState(false);
  const [aiPreview, setAiPreview] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiSelection, setGeminiSelection] = useState<GeminiModelSelection | null>(null);
  const [geminiResult, setGeminiResult] = useState<GeminiAnalysisResult | null>(null);
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [geminiMessage, setGeminiMessage] = useState('');
  const [geminiHasError, setGeminiHasError] = useState(false);
  const [templateWriteStatus, setTemplateWriteStatus] = useState('');
  const geminiAbortRef = useRef<AbortController | null>(null);

  const rules = useMemo(() => evaluateCase(current), [current]);
  const score = useMemo(() => completenessScore(current), [current]);
  const mappingPreviews = useMemo(() => buildAllTemplateMappingPreviews(current), [current]);
  const preflight = useMemo(() => buildCrossDocumentConsistencyReport(current), [current]);
  const pricingItems = current.pricingItems ?? [];
  const internalEstimateTotal = useMemo(
    () => (current.pricingItems ?? []).reduce((sum, item) => sum + (pricingSubtotal(item) ?? 0), 0),
    [current.pricingItems],
  );

  async function refresh() {
    setCases(await listCases());
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => () => geminiAbortRef.current?.abort(), []);

  function patch<K extends keyof ProcurementCase>(key: K, value: ProcurementCase[K]) {
    setSaved(false);
    setTemplateWriteStatus('');
    setCurrent((prev) => ({ ...prev, [key]: value, updatedAt: new Date().toISOString() }));
  }

  function patchPricingItem(id: string, values: Partial<PricingItem>) {
    setSaved(false);
    setTemplateWriteStatus('');
    setCurrent((prev) => ({
      ...prev,
      pricingItems: (prev.pricingItems ?? []).map((item) => (item.id === id ? { ...item, ...values } : item)),
      updatedAt: new Date().toISOString(),
    }));
  }

  function addPricingItem(description = '') {
    setSaved(false);
    setTemplateWriteStatus('');
    setCurrent((prev) => ({
      ...prev,
      pricingItems: [
        ...(prev.pricingItems ?? []),
        { id: crypto.randomUUID(), description },
      ],
      updatedAt: new Date().toISOString(),
    }));
  }

  function removePricingItem(id: string) {
    setSaved(false);
    setTemplateWriteStatus('');
    setCurrent((prev) => ({
      ...prev,
      pricingItems: (prev.pricingItems ?? []).filter((item) => item.id !== id),
      updatedAt: new Date().toISOString(),
    }));
  }

  function syncDeliverablesToPricing() {
    const existing = new Set(pricingItems.map((item) => item.description.trim()).filter(Boolean));
    const additions = current.deliverables
      .map((description) => description.trim())
      .filter((description) => description && !existing.has(description))
      .map((description) => ({ id: crypto.randomUUID(), description }));

    if (!additions.length) {
      setTemplateWriteStatus(current.deliverables.length ? '主要交付成果都已存在於標價項目。' : '目前沒有主要交付成果可建立標價項目。');
      return;
    }

    setSaved(false);
    setTemplateWriteStatus(`已由主要交付成果新增 ${additions.length} 個標價項目；數量、單位與內部預估單價仍須人工填列。`);
    setCurrent((prev) => ({
      ...prev,
      pricingItems: [...(prev.pricingItems ?? []), ...additions],
      updatedAt: new Date().toISOString(),
    }));
  }

  async function save() {
    await upsertCase(current);
    setSaved(true);
    await refresh();
  }

  async function remove(id: string) {
    await deleteCase(id);
    if (current.id === id) setCurrent(newCase());
    await refresh();
  }

  function previewAI() {
    try {
      const context = buildSanitizedAIContext(current);
      setAiPreview(JSON.stringify(context, null, 2));
    } catch (error) {
      setAiPreview(error instanceof Error ? error.message : '無法建立 AI 外送內容');
    }
  }

  function changeGeminiApiKey(value: string) {
    geminiAbortRef.current?.abort();
    geminiAbortRef.current = null;
    setGeminiApiKey(value);
    setGeminiSelection(null);
    setGeminiResult(null);
    setGeminiMessage('');
    setGeminiHasError(false);
    setGeminiBusy(false);
  }

  function clearGeminiApiKey() {
    changeGeminiApiKey('');
    setAiPreview('');
  }

  async function verifyGeminiApiKey() {
    if (!geminiApiKey.trim()) {
      setGeminiHasError(true);
      setGeminiMessage('請先輸入 Gemini API Key。');
      return;
    }

    geminiAbortRef.current?.abort();
    const controller = new AbortController();
    geminiAbortRef.current = controller;
    setGeminiBusy(true);
    setGeminiHasError(false);
    setGeminiMessage('正在向 Google 驗證 API Key 並取得可用模型…');

    try {
      const selection = await validateGeminiApiKey(geminiApiKey, { signal: controller.signal });
      if (geminiAbortRef.current !== controller) return;
      setGeminiSelection(selection);
      setGeminiMessage(
        selection.usedAliasFallback
          ? `API Key 已驗證；模型清單無法辨識穩定版本，將使用官方別名 ${selection.selectedModel}。`
          : `API Key 已驗證；已自動選擇最新穩定 Flash：${selection.selectedModel}。`,
      );
    } catch (error) {
      if (geminiAbortRef.current !== controller) return;
      setGeminiSelection(null);
      setGeminiHasError(true);
      setGeminiMessage(error instanceof Error ? error.message : 'Gemini API Key 驗證失敗。');
    } finally {
      if (geminiAbortRef.current === controller) {
        geminiAbortRef.current = null;
        setGeminiBusy(false);
      }
    }
  }

  async function analyzeCurrentCaseWithGemini() {
    if (!geminiSelection) {
      setGeminiHasError(true);
      setGeminiMessage('請先驗證 Gemini API Key。');
      return;
    }

    let context: ReturnType<typeof buildSanitizedAIContext>;
    try {
      // Privacy gate runs before creating the request or contacting Google.
      context = buildSanitizedAIContext(current);
    } catch (error) {
      setGeminiHasError(true);
      setGeminiMessage(error instanceof Error ? error.message : '此案件禁止使用外部 AI。');
      return;
    }

    geminiAbortRef.current?.abort();
    const controller = new AbortController();
    geminiAbortRef.current = controller;
    setGeminiBusy(true);
    setGeminiHasError(false);
    setGeminiResult(null);
    setGeminiMessage(`正在使用 ${geminiSelection.selectedModel} 分析已去敏感案件資料…`);

    try {
      const result = await externalAIGateway(context, {
        apiKey: geminiApiKey,
        model: geminiSelection.selectedModel,
        signal: controller.signal,
      });
      if (geminiAbortRef.current !== controller) return;
      setGeminiResult(result);
      setGeminiMessage(
        `分析完成；實際模型：${result.resolvedModel}${result.totalTokenCount ? `，共 ${result.totalTokenCount.toLocaleString('zh-TW')} tokens` : ''}。`,
      );
    } catch (error) {
      if (geminiAbortRef.current !== controller) return;
      setGeminiHasError(true);
      setGeminiMessage(error instanceof Error ? error.message : 'Gemini 分析失敗。');
    } finally {
      if (geminiAbortRef.current === controller) {
        geminiAbortRef.current = null;
        setGeminiBusy(false);
      }
    }
  }

  async function exportTenderDraft() {
    setTemplateWriteStatus('正在以工程會官方 DOCX 產製投標須知初稿…');
    try {
      const report = await exportTenderInstructionsDraft(current);
      const applied = report.applied.length ? `已帶入：${report.applied.join('、')}` : '尚無欄位自動帶入';
      const pending = report.pending.length ? `；待人工確認：${report.pending.join('、')}` : '';
      const warnings = report.warnings.length ? `；注意：${report.warnings.join(' ')}` : '';
      setTemplateWriteStatus(`工程會 ${report.templateVersion} 投標須知初稿已產生。${applied}${pending}${warnings}`);
    } catch (error) {
      setTemplateWriteStatus(error instanceof Error ? error.message : '投標須知初稿產製失敗');
    }
  }

  async function exportServiceDraft() {
    setTemplateWriteStatus('正在以工程會官方 ODT 產製勞務採購契約初稿…');
    try {
      const report = await exportServiceContractDraft(current);
      const applied = report.applied.length ? `已帶入：${report.applied.join('、')}` : '尚無欄位自動帶入';
      const pending = report.pending.length ? `；待人工確認：${report.pending.join('、')}` : '';
      const warnings = report.warnings.length ? `；注意：${report.warnings.join(' ')}` : '';
      setTemplateWriteStatus(`工程會 ${report.templateVersion} 勞務採購契約初稿已產生。${applied}${pending}${warnings}`);
    } catch (error) {
      setTemplateWriteStatus(error instanceof Error ? error.message : '勞務採購契約初稿產製失敗');
    }
  }

  async function exportRequirementsDraft() {
    setTemplateWriteStatus('正在依案件欄位產製勞務採購需求規格書初稿…');
    try {
      const report = await exportServiceRequirementsDraft(current);
      const applied = report.applied.length ? `已建立章節：${report.applied.join('、')}` : '尚無完整章節可直接建立';
      const pending = report.pending.length ? `；待人工補充：${report.pending.join('、')}` : '';
      const warnings = report.warnings.length ? `；一致性警示：${report.warnings.join(' ')}` : '';
      setTemplateWriteStatus(`勞務採購需求規格書 DOCX 初稿已產生。${applied}${pending}${warnings}`);
    } catch (error) {
      setTemplateWriteStatus(error instanceof Error ? error.message : '需求規格書初稿產製失敗');
    }
  }

  async function exportPriceSchedule() {
    setTemplateWriteStatus('正在產製標價清單 XLSX 初稿…');
    try {
      const { exportPriceScheduleXlsx } = await import('./price-schedule-writer');
      const report = await exportPriceScheduleXlsx(current);
      const pending = report.pending.length ? `待補：${report.pending.join('、')}。` : '數量與單位已填列。';
      const warnings = report.warnings.length ? ` ${report.warnings.join(' ')}` : '';
      setTemplateWriteStatus(`標價清單 XLSX 初稿已產生，共 ${report.itemCount} 項。${pending}${warnings}`);
    } catch (error) {
      setTemplateWriteStatus(error instanceof Error ? error.message : '標價清單 XLSX 初稿產製失敗');
    }
  }

  async function exportCompletePackage() {
    if (!preflight.canPackage) {
      setTemplateWriteStatus(`完整招標文件包尚未就緒：${preflight.blockers.length} 項阻擋。請先處理「系統警示」中的【禁止整包輸出】項目。`);
      return;
    }

    setTemplateWriteStatus('Preflight 已通過，正在本機產製並打包完整招標文件…');
    try {
      const { exportCompleteServiceProcurementPackage } = await import('./package-writer');
      const report = await exportCompleteServiceProcurementPackage(current);
      setTemplateWriteStatus(`完整招標文件包已產生：${report.filename}，共 ${report.fileCount} 個檔案；另有 ${report.warnings.length} 項非阻擋提醒。`);
    } catch (error) {
      setTemplateWriteStatus(error instanceof Error ? error.message : '完整招標文件包產製失敗');
    }
  }

  const applicableTemplates = templateRegistry.filter(
    (item) => item.category === 'common' || item.category === current.category,
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">GovProcure Assistant · MVP 0.1</p>
          <h1>公務採購文件智慧助理</h1>
          <p className="subtitle">Local-first：案件內容預設只存在這台裝置的瀏覽器，不上傳伺服器。</p>
        </div>
        <div className={`privacy-badge ${geminiSelection ? 'ai-enabled' : ''}`}>
          {geminiSelection ? `✨ Gemini 已就緒 · ${geminiSelection.selectedModel}` : '🔒 AI 外送需使用者 API Key'}
        </div>
      </header>

      <main className="layout">
        <aside className="sidebar card">
          <div className="sidebar-heading">
            <h2>我的案件</h2>
            <button className="secondary" onClick={() => setCurrent(newCase())}>＋ 新案件</button>
          </div>
          {cases.length === 0 ? (
            <p className="muted">目前沒有本機案件。</p>
          ) : (
            <div className="case-list">
              {cases.map((item) => (
                <div className={`case-item ${current.id === item.id ? 'active' : ''}`} key={item.id}>
                  <button className="case-open" onClick={() => setCurrent(item)}>
                    <strong>{item.title || '未命名案件'}</strong>
                    <span>{categoryNames[item.category]} · {new Date(item.updatedAt).toLocaleString('zh-TW')}</span>
                  </button>
                  <button className="danger-link" onClick={() => void remove(item.id)}>刪除</button>
                </div>
              ))}
            </div>
          )}
        </aside>

        <section className="content">
          <div className="card progress-card">
            <div>
              <span className="muted">案件完整度</span>
              <strong className="score">{score}%</strong>
            </div>
            <div className="progress"><span style={{ width: `${score}%` }} /></div>
            <span className={`save-state ${saved ? 'ok' : ''}`}>{saved ? '已儲存於本機' : '尚有未儲存變更'}</span>
          </div>

          <div className="card">
            <h2>1. 基本資料</h2>
            <div className="form-grid">
              <label>機關名稱<input value={current.agency} onChange={(e) => patch('agency', e.target.value)} placeholder="例如：○○縣政府" /></label>
              <label>案名<input value={current.title} onChange={(e) => patch('title', e.target.value)} placeholder="例如：115年度資訊系統維護案" /></label>
              <label>採購類型<select value={current.category} onChange={(e) => patch('category', e.target.value as ProcurementCategory)}><option value="unknown">不知道／稍後判斷</option><option value="service">勞務</option><option value="goods">財物</option><option value="construction">工程</option></select></label>
              <label>預算金額<input type="number" min="0" value={current.budget || ''} onChange={(e) => patch('budget', Number(e.target.value))} placeholder="980000" /></label>
              <label>履約開始<input type="date" value={current.contractStart || ''} onChange={(e) => patch('contractStart', e.target.value)} /></label>
              <label>履約結束<input type="date" value={current.contractEnd || ''} onChange={(e) => patch('contractEnd', e.target.value)} /></label>
            </div>
            <label>採購需求<textarea rows={5} value={current.description} onChange={(e) => patch('description', e.target.value)} placeholder="用白話描述要買什麼、委託什麼、希望廠商完成什麼。" /></label>
          </div>

          <div className="card">
            <h2>2. 招標與決標設定</h2>
            <p className="muted">這些欄位會映射到投標須知與契約；系統只維持跨文件一致，不自動替承辦人判斷法定招標或決標方式。</p>
            <div className="form-grid">
              <label>招標方式<input value={current.procurementMethod ?? ''} onChange={(e) => patch('procurementMethod', e.target.value)} placeholder="例如：公開招標／公開取得報價或企劃書" /></label>
              <label>決標原則<input value={current.awardPrinciple ?? ''} onChange={(e) => patch('awardPrinciple', e.target.value)} placeholder="例如：最低標／最有利標" /></label>
              <label>決標方式<input value={current.awardMethod ?? ''} onChange={(e) => patch('awardMethod', e.target.value)} placeholder="例如：總價決標" /></label>
              <label>契約價金計算方式<input value={current.contractPriceMethod ?? ''} onChange={(e) => patch('contractPriceMethod', e.target.value)} placeholder="例如：總包價法／單價計算法" /></label>
              <label>押標金<input value={current.bidBond ?? ''} onChange={(e) => patch('bidBond', e.target.value)} placeholder="例如：免收／一定金額 30,000 元" /></label>
              <label>履約保證金<input value={current.performanceBond ?? ''} onChange={(e) => patch('performanceBond', e.target.value)} placeholder="例如：免收／契約金額 10%" /></label>
            </div>
          </div>

          <div className="card">
            <h2>3. 履約、驗收與資格</h2>
            <div className="form-grid">
              <label>付款條件<input value={current.paymentTerms} onChange={(e) => patch('paymentTerms', e.target.value)} placeholder="例如：每季驗收合格後付款" /></label>
              <label>驗收方式<input value={current.acceptanceMethod} onChange={(e) => patch('acceptanceMethod', e.target.value)} placeholder="例如：成果報告＋功能測試" /></label>
            </div>
            <label>廠商資格<textarea rows={3} value={current.vendorQualification} onChange={(e) => patch('vendorQualification', e.target.value)} placeholder="尚未確認可先留白，系統會列入人工確認。" /></label>
            <label>主要交付成果<textarea rows={3} value={current.deliverables.join('\n')} onChange={(e) => patch('deliverables', e.target.value.split('\n').map((v) => v.trim()).filter(Boolean))} placeholder={'每行一項，例如：\n每月維護報告\n系統備份紀錄'} /></label>

            <div className="pricing-section">
              <div className="pricing-heading">
                <div>
                  <h3>標價清單工作項目</h3>
                  <p className="muted">可由交付成果建立項目，但系統不會自行猜測數量、單位或價格。預估單價屬內部試算，對外 XLSX 不會帶出。</p>
                </div>
                <div className="pricing-toolbar">
                  <button className="secondary" onClick={syncDeliverablesToPricing}>從交付成果建立</button>
                  <button className="secondary" onClick={() => addPricingItem()}>＋ 新增項目</button>
                </div>
              </div>

              {pricingItems.length ? (
                <>
                  <div className="pricing-table">
                    <div className="pricing-grid pricing-header" aria-hidden="true">
                      <span>#</span><span>工作項目</span><span>數量</span><span>單位</span><span>預估單價（內部）</span><span>預估複價</span><span></span>
                    </div>
                    {pricingItems.map((item, index) => {
                      const subtotal = pricingSubtotal(item);
                      return (
                        <div className="pricing-grid pricing-row" key={item.id}>
                          <span className="pricing-index">{index + 1}</span>
                          <input aria-label={`第 ${index + 1} 項工作項目`} value={item.description} onChange={(e) => patchPricingItem(item.id, { description: e.target.value })} placeholder="工作項目／交付成果" />
                          <input aria-label={`第 ${index + 1} 項數量`} type="number" min="0" step="any" value={item.quantity ?? ''} onChange={(e) => patchPricingItem(item.id, { quantity: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="數量" />
                          <input aria-label={`第 ${index + 1} 項單位`} value={item.unit ?? ''} onChange={(e) => patchPricingItem(item.id, { unit: e.target.value })} placeholder="式／月／件" />
                          <input aria-label={`第 ${index + 1} 項內部預估單價`} type="number" min="0" step="1" value={item.estimatedUnitPrice ?? ''} onChange={(e) => patchPricingItem(item.id, { estimatedUnitPrice: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="僅供內部試算" />
                          <strong className="pricing-subtotal">{subtotal === undefined ? '—' : `NT$ ${Math.round(subtotal).toLocaleString('zh-TW')}`}</strong>
                          <button className="danger-link" onClick={() => removePricingItem(item.id)}>刪除</button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="pricing-summary">
                    <span>內部預估合計（已填項目）</span>
                    <strong>NT$ {Math.round(internalEstimateTotal).toLocaleString('zh-TW')}</strong>
                    {current.budget > 0 && internalEstimateTotal > 0 && (
                      <small className={Math.abs(current.budget - internalEstimateTotal) < 1 ? 'pricing-ok' : 'pricing-warning'}>
                        {Math.abs(current.budget - internalEstimateTotal) < 1
                          ? '與預算金額一致'
                          : current.budget > internalEstimateTotal
                            ? `較預算少 NT$ ${Math.round(current.budget - internalEstimateTotal).toLocaleString('zh-TW')}`
                            : `超過預算 NT$ ${Math.round(internalEstimateTotal - current.budget).toLocaleString('zh-TW')}`}
                      </small>
                    )}
                  </div>
                </>
              ) : (
                <p className="muted">尚未建立標價項目。可先填主要交付成果，再按「從交付成果建立」。</p>
              )}
            </div>
          </div>

          <div className="card security-card">
            <h2>4. 機敏資料控管</h2>
            <div className="form-grid">
              <label>案件安全等級<select value={current.securityLevel} onChange={(e) => patch('securityLevel', e.target.value as SecurityLevel)}>{Object.entries(securityNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>底價／預估底價（高度敏感）<input type="number" value={current.reservePrice ?? ''} onChange={(e) => patch('reservePrice', e.target.value ? Number(e.target.value) : undefined)} placeholder="如有填寫，禁止外送 LLM" /></label>
            </div>
            <label>內部備註<textarea rows={3} value={current.internalNotes} onChange={(e) => patch('internalNotes', e.target.value)} placeholder="此欄永遠不納入 AI 外送內容。" /></label>

            <div className="gemini-panel">
              <div className="gemini-heading">
                <div>
                  <h3>Gemini AI（使用者自備 Key）</h3>
                  <p className="muted">系統會從 Google 模型清單自動選擇最新穩定的文字 Flash；若命名規則改變，才改用官方 latest 別名。</p>
                </div>
                <span className={`tag ${geminiSelection ? 'current' : 'untracked'}`}>
                  {geminiSelection ? '已驗證' : '未連線'}
                </span>
              </div>

              <div className="gemini-key-row">
                <label>
                  Gemini API Key
                  <input
                    type="password"
                    value={geminiApiKey}
                    onChange={(event) => changeGeminiApiKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !geminiBusy) void verifyGeminiApiKey();
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="貼上 Google AI Studio API Key"
                    aria-describedby="gemini-key-notice"
                  />
                </label>
                <button disabled={geminiBusy || !geminiApiKey.trim()} onClick={() => void verifyGeminiApiKey()}>
                  {geminiBusy ? '處理中…' : '驗證 Key'}
                </button>
                <button className="secondary" disabled={!geminiApiKey && !geminiSelection} onClick={clearGeminiApiKey}>清除</button>
              </div>

              <p id="gemini-key-notice" className="gemini-key-notice">
                Key 只保留在目前頁面的記憶體，重新整理就會清除；不會寫入案件、IndexedDB、GitHub、網址或匯出文件。
                GitHub Pages 會從瀏覽器直接連到 Google，請使用專用且受限制的 Key。
              </p>
              <p className="gemini-links">
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">取得 Gemini API Key</a>
                <span>·</span>
                <a href="https://ai.google.dev/gemini-api/docs/api-key" target="_blank" rel="noreferrer">Google Key 安全說明</a>
              </p>

              <div className="gemini-actions">
                <button className="secondary" onClick={previewAI}>預覽將外送的去敏感資料</button>
                <button
                  disabled={geminiBusy || !geminiSelection}
                  onClick={() => void analyzeCurrentCaseWithGemini()}
                >
                  {geminiBusy ? 'Gemini 處理中…' : '使用 Gemini 檢查案件缺漏'}
                </button>
              </div>

              {geminiMessage && (
                <p className={`gemini-status ${geminiHasError ? 'error' : geminiSelection ? 'success' : ''}`} role="status">
                  {geminiMessage}
                </p>
              )}
              {aiPreview && (
                <div className="ai-output-block">
                  <strong>實際外送資料預覽</strong>
                  <pre className="preview">{aiPreview}</pre>
                </div>
              )}
              {geminiResult && (
                <div className="ai-output-block">
                  <div className="ai-result-heading">
                    <strong>Gemini 檢核建議</strong>
                    <small>{geminiResult.requestedModel} → {geminiResult.resolvedModel}</small>
                  </div>
                  <div className="ai-result">{geminiResult.text}</div>
                  <p className="ai-disclaimer">AI 結果只供審查，不會自動改寫案件欄位或決定法定採購選項。</p>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h2>5. 系統判斷的文件清單</h2>
            <div className="columns">
              <div><h3>必要文件</h3><ul>{rules.requiredDocuments.map((item) => <li key={item}>✅ {item}</li>)}</ul></div>
              <div><h3>可能需要</h3><ul>{rules.optionalDocuments.map((item) => <li key={item}>◻️ {item}</li>)}</ul></div>
            </div>
            {rules.confirmations.length > 0 && <div className="notice warning"><strong>需人工確認</strong><ul>{rules.confirmations.map((item) => <li key={item}>{item}</li>)}</ul></div>}
            {rules.warnings.length > 0 && <div className="notice danger"><strong>系統警示</strong><ul>{rules.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          </div>

          <div className="card">
            <h2>6. 官方範本欄位 Mapping</h2>
            <p className="muted">同一個 ProcurementCase 是所有文件的單一資料來源。下面顯示目前資料可以填入哪些官方範本位置，以及仍缺哪些必要欄位。</p>
            <div className="template-list">
              {mappingPreviews.map((preview) => (
                <div className="mapping-block" key={preview.templateId}>
                  <div className="template-row">
                    <span><strong>{preview.templateName}</strong><small>必要欄位 {preview.readyRequiredCount}/{preview.requiredCount}</small></span>
                    <span className={`tag ${preview.coverage === 100 ? 'current' : 'candidate'}`}>{preview.coverage}%</span>
                  </div>
                  <ul>
                    {preview.rows.map((row) => (
                      <li key={`${preview.templateId}-${row.key}`}>
                        {row.ready ? '✅' : row.required ? '⚠️' : '◻️'} <strong>{row.canonicalLabel}</strong> → {row.targetLabel}：{row.ready ? row.value : '待填'}
                        <small className="muted"> · Anchor：{row.anchor}{row.note ? ` · ${row.note}` : ''}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>7. 工程會範本 Registry</h2>
            <p className="muted">PCC Watcher 會監測公開索引，並另外封存核心範本的 Word / ODT / PDF 與 SHA-256。偵測到新版時只建立 candidate，必須人工確認後才可更新 active 範本。</p>
            <div className="template-list">
              {applicableTemplates.map((item) => {
                const observed = getTemplateObservation(item);
                const archive = getTemplateArchive(item);
                const syncStatus = getTemplateSyncStatus(item);
                return (
                  <div className="template-row" key={item.id}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>目前採用：{item.officialDate}{observed ? ` · 官方索引：${formatRocDate(observed.officialDate)}` : ''}</small>
                      <small>{archive ? `檔案封存：${formatRocDate(archive.latestObservedVersion)} · ${archive.versions[0]?.files.length ?? 0} 種格式` : '檔案封存：尚未建立'}</small>
                    </span>
                    <span className={`tag ${syncStatus}`}>{syncLabels[syncStatus]}</span>
                  </div>
                );
              })}
            </div>
            <p className="registry-source">監測來源：<a href={pccTemplateIndex.sourceUrl} target="_blank" rel="noreferrer">工程會「招標相關文件及表格」</a></p>
          </div>

          <div className="actions card">
            <button onClick={() => void save()}>儲存到本機</button>
            <button className="secondary" onClick={() => exportCaseJson(current)}>匯出 JSON 備份</button>
            <button className="secondary" onClick={() => void exportCaseDocx(current, rules)}>匯出 DOCX 檢核表</button>
            <button onClick={() => void exportTenderDraft()}>產出工程會投標須知 DOCX 初稿</button>
            {current.category === 'service' && (
              <>
                <button onClick={() => void exportServiceDraft()}>產出工程會勞務採購契約 ODT 初稿</button>
                <button onClick={() => void exportRequirementsDraft()}>產出勞務採購需求規格書 DOCX 初稿</button>
              </>
            )}
            <button onClick={() => void exportPriceSchedule()}>產出標價清單 XLSX 初稿</button>
            {current.category === 'service' && (
              <button
                className="package-primary"
                disabled={!preflight.canPackage}
                onClick={() => void exportCompletePackage()}
                title={preflight.canPackage ? 'Preflight 已通過，可產生完整招標文件包' : `尚有 ${preflight.blockers.length} 項阻擋事項`}
              >
                一鍵下載完整招標文件包 ZIP
              </button>
            )}
            {current.category === 'service' && (
              <p className={`package-readiness ${preflight.canPackage ? 'ready' : 'blocked'}`}>
                {preflight.canPackage
                  ? `整包輸出就緒｜${preflight.warnings.length} 項非阻擋提醒`
                  : `整包輸出未就緒｜${preflight.blockers.length} 項阻擋、${preflight.warnings.length} 項提醒`}
              </p>
            )}
            {templateWriteStatus && <p className="template-write-status">{templateWriteStatus}</p>}
          </div>
        </section>
      </main>
    </div>
  );
}
