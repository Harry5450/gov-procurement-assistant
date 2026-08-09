import { useEffect, useMemo, useState } from 'react';
import { deleteCase, listCases, upsertCase } from './db';
import { exportCaseDocx, exportCaseJson } from './export';
import { buildAllTemplateMappingPreviews } from './mapping';
import { completenessScore, evaluateCase } from './rules';
import { buildSanitizedAIContext } from './privacy';
import { formatRocDate, getTemplateArchive, getTemplateObservation, getTemplateSyncStatus, pccTemplateIndex } from './pcc';
import { templateRegistry } from './templates';
import type { ProcurementCase, ProcurementCategory, SecurityLevel } from './types';

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

export default function App() {
  const [current, setCurrent] = useState<ProcurementCase>(newCase());
  const [cases, setCases] = useState<ProcurementCase[]>([]);
  const [saved, setSaved] = useState(false);
  const [aiPreview, setAiPreview] = useState('');

  const rules = useMemo(() => evaluateCase(current), [current]);
  const score = useMemo(() => completenessScore(current), [current]);
  const mappingPreviews = useMemo(() => buildAllTemplateMappingPreviews(current), [current]);

  async function refresh() {
    setCases(await listCases());
  }

  useEffect(() => {
    void refresh();
  }, []);

  function patch<K extends keyof ProcurementCase>(key: K, value: ProcurementCase[K]) {
    setSaved(false);
    setCurrent((prev) => ({ ...prev, [key]: value, updatedAt: new Date().toISOString() }));
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
        <div className="privacy-badge">🔒 AI 外送預設關閉</div>
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
          </div>

          <div className="card security-card">
            <h2>4. 機敏資料控管</h2>
            <div className="form-grid">
              <label>案件安全等級<select value={current.securityLevel} onChange={(e) => patch('securityLevel', e.target.value as SecurityLevel)}>{Object.entries(securityNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>底價／預估底價（高度敏感）<input type="number" value={current.reservePrice ?? ''} onChange={(e) => patch('reservePrice', e.target.value ? Number(e.target.value) : undefined)} placeholder="如有填寫，禁止外送 LLM" /></label>
            </div>
            <label>內部備註<textarea rows={3} value={current.internalNotes} onChange={(e) => patch('internalNotes', e.target.value)} placeholder="此欄永遠不納入 AI 外送內容。" /></label>
            <button className="secondary" onClick={previewAI}>預覽「若啟用 AI」可外送內容</button>
            {aiPreview && <pre className="preview">{aiPreview}</pre>}
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
          </div>
        </section>
      </main>
    </div>
  );
}
