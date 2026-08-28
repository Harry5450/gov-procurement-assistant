import type { FieldDefinition, SourceDocument, WorkflowStage } from './types';
import type { CaseReadinessReport, FieldReadiness } from './case-workflow';

const stageIndex: Record<WorkflowStage, number> = {
  intake: 0,
  'requirements-review': 0,
  'procurement-decisions': 1,
  'tender-draft': 2,
  'contract-draft': 2,
  review: 3,
  exported: 3,
};

const workflowSteps = [
  { title: '需求形成', description: '引導建立或匯入需求' },
  { title: '採購決策', description: '招標、決標與價金方式' },
  { title: '文件製作', description: '投標須知與契約逐節確認' },
  { title: '檢核匯出', description: '跨文件一致性與正式輸出' },
] as const;

const requirementLabels: Record<FieldDefinition['requirement'], string> = {
  required: '必填',
  conditional: '條件必填',
  defaulted: '範本預設',
  optional: '選填',
};

const statusLabels: Record<FieldReadiness['status'], string> = {
  resolved: '已確認',
  'not-applicable': '目前不適用',
  missing: '尚未填寫',
  'needs-confirmation': '待人工確認',
  invalid: '需要處理',
  optional: '選填',
};

export function WorkflowStepper({ stage }: { stage: WorkflowStage }) {
  const activeIndex = stageIndex[stage];
  return (
    <nav className="workflow-stepper card" aria-label="案件製作進度">
      {workflowSteps.map((step, index) => {
        const state = index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'upcoming';
        return (
          <div className={`workflow-step ${state}`} key={step.title} aria-current={state === 'active' ? 'step' : undefined}>
            <span className="workflow-step-number" aria-hidden="true">{index < activeIndex ? '✓' : index + 1}</span>
            <span>
              <strong>{step.title}</strong>
              <small>{step.description}</small>
            </span>
          </div>
        );
      })}
    </nav>
  );
}

export function FieldReadinessPanel({
  title,
  description,
  report,
  definitions,
}: {
  title: string;
  description: string;
  report: CaseReadinessReport;
  definitions: readonly FieldDefinition[];
}) {
  const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]));
  const fields = report.fields.filter((field) => definitionMap.has(field.fieldId));

  return (
    <section className="field-readiness" aria-labelledby={`${title}-heading`}>
      <div className="field-readiness-heading">
        <div>
          <h3 id={`${title}-heading`}>{title}</h3>
          <p className="muted">{description}</p>
        </div>
        <span className={`readiness-score ${report.ready ? 'ready' : ''}`}>
          {report.resolvedRequired}/{report.applicableRequired}
        </span>
      </div>
      <div className="field-guide-grid">
        {fields.map((field) => {
          const definition = definitionMap.get(field.fieldId)!;
          return (
            <article className={`field-guide ${field.status}`} key={field.fieldId}>
              <div className="field-guide-heading">
                <strong>{definition.label}</strong>
                <span className={`field-state ${field.status}`}>{statusLabels[field.status]}</span>
              </div>
              <p>{definition.purpose}</p>
              <small><b>{requirementLabels[definition.requirement]}</b> · {definition.helpText}</small>
              {definition.legalBasis && <a href={definition.legalBasis} target="_blank" rel="noreferrer">查看官方依據</a>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export interface LocalImportPreview {
  fileName: string;
  status: 'parsing' | 'parsed' | 'manual-review' | 'failed';
  text?: string;
  blockCount?: number;
  message?: string;
}

export function ImportedRequirementPreview({
  source,
  preview,
}: {
  source?: SourceDocument;
  preview: LocalImportPreview | null;
}) {
  if (!source && !preview) return null;
  return (
    <section className="import-review card" aria-labelledby="import-review-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">本機需求來源</p>
          <h2 id="import-review-heading">需求書擷取預覽</h2>
          <p className="muted">原始檔不會寫入案件或傳給 AI；擷取文字只保留在這次頁面的記憶體，供您對照填寫。</p>
        </div>
        <span className={`tag ${preview?.status === 'parsed' ? 'current' : 'candidate'}`}>
          {preview?.status === 'parsing' ? '解析中' : preview?.status === 'parsed' ? '已在本機擷取' : '需人工查看'}
        </span>
      </div>
      <dl className="source-metadata">
        <div><dt>檔案</dt><dd>{source?.fileName ?? preview?.fileName}</dd></div>
        {source?.sizeBytes !== undefined && <div><dt>大小</dt><dd>{Math.max(1, Math.round(source.sizeBytes / 1024)).toLocaleString('zh-TW')} KB</dd></div>}
        <div><dt>保存方式</dt><dd>僅保存檔名、格式與狀態</dd></div>
      </dl>
      {preview?.message && <div className="notice warning">{preview.message}</div>}
      {preview?.text && (
        <details className="local-text-preview">
          <summary>查看本機擷取文字（{preview.blockCount ?? 0} 個段落／表格列）</summary>
          <pre>{preview.text}</pre>
        </details>
      )}
    </section>
  );
}

export function RequirementSummary({
  title,
  agency,
  description,
  deliverables,
  onEdit,
}: {
  title: string;
  agency: string;
  description: string;
  deliverables: string[];
  onEdit: () => void;
}) {
  return (
    <section className="requirement-summary card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">已確認的需求基礎</p>
          <h2>{title || '未命名案件'}</h2>
          <p className="muted">{agency || '機關名稱待填'} · {deliverables.length} 項主要交付成果</p>
        </div>
        <button className="secondary" onClick={onEdit}>返回修改需求</button>
      </div>
      <p className="requirement-summary-text">{description || '尚未填寫採購目的與範圍。'}</p>
    </section>
  );
}
