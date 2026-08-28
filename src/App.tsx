import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCrossDocumentConsistencyReport } from './consistency';
import {
  evaluateCaseReadiness,
  getWorkflowFieldDefinitions,
  normalizeProcurementCase,
  updateCaseField,
} from './case-workflow';
import { deleteCase, listCases, upsertCase } from './db';
import { exportCaseDocx, exportCaseJson } from './export';
import { buildAllTemplateMappingPreviews } from './mapping';
import { completenessScore, evaluateCase } from './rules';
import { buildSanitizedAIContext, externalAIGateway, externalDraftAIGateway } from './privacy';
import {
  validateGeminiApiKey,
  type GeminiAnalysisResult,
  type GeminiModelSelection,
  type GeminiProcurementDraftResult,
} from './gemini';
import {
  buildProcurementGuidance,
  PROCUREMENT_RULESET,
  type GuidanceOption,
} from './procurement-guidance';
import { formatRocDate, getTemplateArchive, getTemplateObservation, getTemplateSyncStatus, pccTemplateIndex } from './pcc';
import {
  PCC_CANDIDATE_PULL_REQUESTS_URL,
  PCC_TEMPLATE_PROMOTION_ACTIONS_URL,
  PCC_TEMPLATE_WATCHER_ACTIONS_URL,
  templateRegistry,
} from './templates';
import { exportTenderInstructionsDraft } from './template-writer';
import { exportServiceContractDraft } from './service-contract-writer';
import { exportServiceRequirementsDraft } from './requirements-writer';
import RequirementsIntake, { type RequirementsIntakeMode } from './intake-components';
import type { IntakeFileValidationResult } from './intake-file';
import { LocalDocumentParseError, parseLocalDocumentFile } from './local-document-parser';
import {
  FieldReadinessPanel,
  ImportedRequirementPreview,
  RequirementSummary,
  WorkflowStepper,
  type LocalImportPreview,
} from './workflow-components';
import type {
  FieldDefinition,
  PricingItem,
  ProcurementCase,
  ProcurementCategory,
  SecurityLevel,
  SourceDocument,
} from './types';

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
    schemaVersion: 2,
    workflowStage: 'intake',
    sourceDocuments: [],
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

const requirementFieldDefinitions: FieldDefinition[] = [
  ...getWorkflowFieldDefinitions('requirements'),
  ...getWorkflowFieldDefinitions('pricing'),
];

const decisionFieldDefinitions: FieldDefinition[] = [
  ...getWorkflowFieldDefinitions('decisions'),
  ...getWorkflowFieldDefinitions('contract'),
];

const legacyFieldDefinitionByKey = new Map(
  [...requirementFieldDefinitions, ...decisionFieldDefinitions]
    .filter((definition) => definition.legacyKey)
    .map((definition) => [definition.legacyKey!, definition] as const),
);

const workflowDefinitionById = new Map(
  [...requirementFieldDefinitions, ...decisionFieldDefinitions].map((definition) => [definition.id, definition] as const),
);

function pricingSubtotal(item: PricingItem) {
  if (item.quantity === undefined || item.estimatedUnitPrice === undefined) return undefined;
  return item.quantity * item.estimatedUnitPrice;
}

function GuidedSelect({
  label,
  value,
  options,
  recommended,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: GuidanceOption[];
  recommended: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selected = options.find((option) => option.value === value);
  const recommendation = options.find((option) => option.value === recommended);
  const isLegacyValue = Boolean(value && !selected);
  const hint = selected ?? recommendation;

  return (
    <label className="guided-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">{disabled ? '請先完成前置欄位' : recommendation ? `請選擇（建議：${recommendation.label}）` : '請選擇／人工確認'}</option>
        {isLegacyValue && <option value={value}>目前值：{value}（請重新確認）</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value === recommended ? '★ ' : ''}{option.label}{option.requiresJustification ? '｜須敘明理由' : ''}
          </option>
        ))}
      </select>
      {hint && (
        <small className={selected?.requiresJustification ? 'guided-warning' : ''}>
          {selected ? '' : '系統建議：'}{hint.description}（{hint.legalBasis}）
        </small>
      )}
    </label>
  );
}

export default function App() {
  const [current, setCurrent] = useState<ProcurementCase>(newCase());
  const [cases, setCases] = useState<ProcurementCase[]>([]);
  const [saved, setSaved] = useState(false);
  const [aiPreview, setAiPreview] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiSelection, setGeminiSelection] = useState<GeminiModelSelection | null>(null);
  const [geminiResult, setGeminiResult] = useState<GeminiAnalysisResult | null>(null);
  const [geminiDraft, setGeminiDraft] = useState<{
    result: GeminiProcurementDraftResult;
    sourceCaseId: string;
    sourceUpdatedAt: string;
  } | null>(null);
  const [geminiDraftMessage, setGeminiDraftMessage] = useState('');
  const [geminiDraftHasError, setGeminiDraftHasError] = useState(false);
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [geminiMessage, setGeminiMessage] = useState('');
  const [geminiHasError, setGeminiHasError] = useState(false);
  const [templateWriteStatus, setTemplateWriteStatus] = useState('');
  const [intakeFileResult, setIntakeFileResult] = useState<IntakeFileValidationResult | null>(null);
  const [localImportPreview, setLocalImportPreview] = useState<LocalImportPreview | null>(null);
  const [workflowMessage, setWorkflowMessage] = useState('');
  const geminiAbortRef = useRef<AbortController | null>(null);

  const rules = useMemo(() => evaluateCase(current), [current]);
  const score = useMemo(() => completenessScore(current), [current]);
  const mappingPreviews = useMemo(() => buildAllTemplateMappingPreviews(current), [current]);
  const preflight = useMemo(() => buildCrossDocumentConsistencyReport(current), [current]);
  const workflowCase = useMemo(() => normalizeProcurementCase(current), [current]);
  const requirementsReadiness = useMemo(
    () => evaluateCaseReadiness(workflowCase, requirementFieldDefinitions),
    [workflowCase],
  );
  const decisionReadiness = useMemo(
    () => evaluateCaseReadiness(workflowCase, decisionFieldDefinitions),
    [workflowCase],
  );
  const formalReadiness = useMemo(() => evaluateCaseReadiness(workflowCase), [workflowCase]);
  const procurementGuidance = useMemo(() => buildProcurementGuidance({
    budget: current.budget,
    category: current.category,
    procurementMethod: current.procurementMethod,
    awardPrinciple: current.awardPrinciple,
    awardMethod: current.awardMethod,
    contractPriceMethod: current.contractPriceMethod,
  }), [
    current.budget,
    current.category,
    current.procurementMethod,
    current.awardPrinciple,
    current.awardMethod,
    current.contractPriceMethod,
  ]);
  const geminiDraftIsStale = Boolean(geminiDraft && (
    geminiDraft.sourceCaseId !== current.id || geminiDraft.sourceUpdatedAt !== current.updatedAt
  ));
  const pricingItems = current.pricingItems ?? [];
  const internalEstimateTotal = useMemo(
    () => (current.pricingItems ?? []).reduce((sum, item) => sum + (pricingSubtotal(item) ?? 0), 0),
    [current.pricingItems],
  );
  const workflowStage = current.workflowStage
    ?? (current.schemaVersion === 2 ? 'intake' : 'procurement-decisions');
  const intakeUiMode: RequirementsIntakeMode | null = current.intakeMode === 'guided' || current.intakeMode === 'upload'
    ? current.intakeMode
    : null;
  const isIntake = workflowStage === 'intake';
  const isRequirementsReview = workflowStage === 'requirements-review';
  const isDocumentWorkflow = !isIntake && !isRequirementsReview;
  const canFormalPackage = preflight.canPackage && formalReadiness.ready;
  const workflowFieldValue = (fieldId: string) => workflowCase.fields[fieldId]?.value;
  const workflowFieldIsApplicable = (fieldId: string) => formalReadiness.fields.find((field) => field.fieldId === fieldId)?.applicable ?? false;

  async function refresh() {
    setCases(await listCases());
  }

  function beginNewCase() {
    setCurrent(newCase());
    setIntakeFileResult(null);
    setLocalImportPreview(null);
    setWorkflowMessage('');
    setTemplateWriteStatus('');
    setSaved(false);
  }

  function openCase(procurementCase: ProcurementCase) {
    setCurrent(normalizeProcurementCase(procurementCase));
    setIntakeFileResult(null);
    setLocalImportPreview(null);
    setWorkflowMessage('');
    setTemplateWriteStatus('');
    setSaved(true);
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => () => geminiAbortRef.current?.abort(), []);

  function patch<K extends keyof ProcurementCase>(key: K, value: ProcurementCase[K]) {
    setSaved(false);
    setTemplateWriteStatus('');
    setWorkflowMessage('');
    setCurrent((prev) => {
      const updated = { ...prev, [key]: value, updatedAt: new Date().toISOString() };
      const definition = legacyFieldDefinitionByKey.get(key);
      return definition
        ? updateCaseField(updated, definition.id, { value, confirmed: false, sourceKind: 'user' })
        : updated;
    });
  }

  function patchPricingItem(id: string, values: Partial<PricingItem>) {
    setSaved(false);
    setTemplateWriteStatus('');
    setCurrent((prev) => {
      const pricingItems = (prev.pricingItems ?? []).map((item) => (item.id === id ? { ...item, ...values } : item));
      return updateCaseField(
        { ...prev, pricingItems, updatedAt: new Date().toISOString() },
        'pricing.items',
        { value: pricingItems, confirmed: false, sourceKind: 'user' },
      );
    });
  }

  function addPricingItem(description = '') {
    setSaved(false);
    setTemplateWriteStatus('');
    setCurrent((prev) => {
      const pricingItems = [
        ...(prev.pricingItems ?? []),
        { id: crypto.randomUUID(), description },
      ];
      return updateCaseField(
        { ...prev, pricingItems, updatedAt: new Date().toISOString() },
        'pricing.items',
        { value: pricingItems, confirmed: false, sourceKind: 'user' },
      );
    });
  }

  function removePricingItem(id: string) {
    setSaved(false);
    setTemplateWriteStatus('');
    setCurrent((prev) => {
      const pricingItems = (prev.pricingItems ?? []).filter((item) => item.id !== id);
      return updateCaseField(
        { ...prev, pricingItems, updatedAt: new Date().toISOString() },
        'pricing.items',
        { value: pricingItems, confirmed: false, sourceKind: 'user' },
      );
    });
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
    setCurrent((prev) => {
      const nextPricingItems = [...(prev.pricingItems ?? []), ...additions];
      return updateCaseField(
        { ...prev, pricingItems: nextPricingItems, updatedAt: new Date().toISOString() },
        'pricing.items',
        { value: nextPricingItems, confirmed: false, sourceKind: 'user' },
      );
    });
  }

  async function save() {
    await upsertCase(current);
    setSaved(true);
    await refresh();
  }

  async function remove(id: string) {
    await deleteCase(id);
    if (current.id === id) beginNewCase();
    await refresh();
  }

  function chooseIntakeMode(mode: RequirementsIntakeMode) {
    setIntakeFileResult(null);
    setLocalImportPreview(null);
    setWorkflowMessage('');
    setSaved(false);
    setCurrent((prev) => normalizeProcurementCase({
      ...prev,
      intakeMode: mode,
      workflowStage: 'intake',
      updatedAt: new Date().toISOString(),
    }));
  }

  function startGuidedRequirements() {
    setWorkflowMessage('請依序完成必填需求；所有欄位都會保留用途與填寫說明。');
    setSaved(false);
    setCurrent((prev) => normalizeProcurementCase({
      ...prev,
      intakeMode: 'guided',
      workflowStage: 'requirements-review',
      updatedAt: new Date().toISOString(),
    }));
  }

  async function parseSelectedRequirementFile(file: File, result: IntakeFileValidationResult) {
    if (!result.ok) return;
    setLocalImportPreview({ fileName: file.name, status: 'parsing', message: '正在瀏覽器記憶體中擷取文字…' });
    try {
      const parsed = await parseLocalDocumentFile(file);
      setLocalImportPreview({
        fileName: parsed.fileName,
        status: 'parsed',
        text: parsed.text,
        blockCount: parsed.blocks.length,
        message: '文字已在本機擷取；系統不會自動把它判定為正式欄位，請逐項確認。',
      });
    } catch (error) {
      const isPdf = error instanceof LocalDocumentParseError && error.code === 'UNSUPPORTED_PDF';
      setLocalImportPreview({
        fileName: file.name,
        status: isPdf ? 'manual-review' : 'failed',
        message: isPdf
          ? 'PDF 已可作為來源附件，但本版尚未自動擷取 PDF 文字；請依原文件人工補登並確認欄位。'
          : error instanceof Error
            ? `本機解析失敗：${error.message}`
            : '本機解析失敗，請改用 DOCX 或 ODT。',
      });
    }
  }

  function confirmUploadedRequirement(result: IntakeFileValidationResult) {
    if (!result.ok || localImportPreview?.status === 'parsing') return;
    const format = result.metadata.kind === 'docx' || result.metadata.kind === 'odt' || result.metadata.kind === 'pdf'
      ? result.metadata.kind
      : 'other';
    const source: SourceDocument = {
      id: crypto.randomUUID(),
      name: result.metadata.name,
      fileName: result.metadata.name,
      format,
      mimeType: result.metadata.mimeType || undefined,
      sizeBytes: result.metadata.size,
      importedAt: new Date().toISOString(),
      status: localImportPreview?.status === 'parsed'
        ? 'parsed'
        : localImportPreview?.status === 'failed'
          ? 'failed'
          : 'needs-review',
      localOnly: true,
      parserVersion: localImportPreview?.status === 'parsed' ? 'local-xml-v1' : undefined,
      error: localImportPreview?.status === 'failed' ? localImportPreview.message : undefined,
    };
    setWorkflowMessage('需求書已登記為本機來源。請對照原文逐項完成需求確認；系統尚未替您作成任何法定判斷。');
    setSaved(false);
    setCurrent((prev) => normalizeProcurementCase({
      ...prev,
      intakeMode: 'upload',
      workflowStage: 'requirements-review',
      sourceDocuments: [...(prev.sourceDocuments ?? []), source],
      updatedAt: new Date().toISOString(),
    }));
  }

  function confirmRequirementsAndContinue() {
    let candidate = normalizeProcurementCase(current);
    for (const definition of requirementFieldDefinitions) {
      const field = candidate.fields[definition.id];
      if (!field || field.state === 'missing' || field.state === 'unknown' || field.state === 'conflict') continue;
      candidate = updateCaseField(candidate, definition.id, {
        confirmed: true,
        source: field.source ?? { kind: 'user' },
      });
    }
    const report = evaluateCaseReadiness(candidate, requirementFieldDefinitions);
    if (!report.ready) {
      setCurrent(candidate);
      setWorkflowMessage(`需求尚未完成：請處理 ${report.blockingIssues.map((item) => item.label).join('、')}。`);
      return;
    }
    setWorkflowMessage('需求基礎已確認。接下來請完成招標、決標、押標金、保險及契約條件。');
    setSaved(false);
    setCurrent({
      ...candidate,
      workflowStage: 'procurement-decisions',
      updatedAt: new Date().toISOString(),
    });
  }

  function returnToRequirements() {
    setWorkflowMessage('需求已重新開啟；修改後請再次確認。');
    setSaved(false);
    setCurrent((prev) => ({
      ...prev,
      workflowStage: 'requirements-review',
      updatedAt: new Date().toISOString(),
    }));
  }

  function patchWorkflowField(fieldId: string, value: unknown) {
    setSaved(false);
    setTemplateWriteStatus('');
    setWorkflowMessage('');
    setCurrent((prev) => {
      const next = updateCaseField(prev, fieldId, { value, confirmed: false, sourceKind: 'user' });
      return next.workflowStage === 'tender-draft' || next.workflowStage === 'contract-draft' || next.workflowStage === 'review'
        ? { ...next, workflowStage: 'procurement-decisions' }
        : next;
    });
  }

  function confirmProcurementAndContractSettings() {
    let candidate = normalizeProcurementCase(current);
    for (const definition of decisionFieldDefinitions) {
      const field = candidate.fields[definition.id];
      if (!field || field.state === 'missing' || field.state === 'unknown' || field.state === 'conflict') continue;
      candidate = updateCaseField(candidate, definition.id, {
        confirmed: true,
        source: field.source ?? { kind: 'user' },
      });
    }
    const report = evaluateCaseReadiness(candidate);
    if (!report.ready) {
      setCurrent(candidate);
      setWorkflowMessage(`招標與契約設定尚未完成：請處理 ${report.blockingIssues.map((item) => item.label).join('、')}。`);
      return;
    }
    setSaved(false);
    setWorkflowMessage('採購與契約條件已確認，可以進行跨文件檢查與草稿產製。');
    setCurrent({
      ...candidate,
      workflowStage: 'tender-draft',
      updatedAt: new Date().toISOString(),
    });
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
    setGeminiDraft(null);
    setGeminiDraftMessage('');
    setGeminiDraftHasError(false);
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

  async function generateEditableProcurementDraft() {
    if (!geminiSelection) {
      setGeminiDraftHasError(true);
      setGeminiDraftMessage('請先在本區下方驗證 Gemini API Key。');
      return;
    }
    if (current.category === 'unknown' || !current.description.trim()) {
      setGeminiDraftHasError(true);
      setGeminiDraftMessage('請先填寫採購類型與採購需求，Gemini 才能起草履約內容。');
      return;
    }

    let context: ReturnType<typeof buildSanitizedAIContext>;
    try {
      context = buildSanitizedAIContext(current);
    } catch (error) {
      setGeminiDraftHasError(true);
      setGeminiDraftMessage(error instanceof Error ? error.message : '此案件禁止使用外部 AI。');
      return;
    }

    const sourceCaseId = current.id;
    const sourceUpdatedAt = current.updatedAt;
    geminiAbortRef.current?.abort();
    const controller = new AbortController();
    geminiAbortRef.current = controller;
    setGeminiBusy(true);
    setGeminiDraftHasError(false);
    setGeminiDraft(null);
    setGeminiDraftMessage(`正在使用 ${geminiSelection.selectedModel} 產生履約與標價項目草稿…`);

    try {
      const result = await externalDraftAIGateway(context, {
        apiKey: geminiApiKey,
        model: geminiSelection.selectedModel,
        signal: controller.signal,
      });
      if (geminiAbortRef.current !== controller) return;
      setGeminiDraft({ result, sourceCaseId, sourceUpdatedAt });
      setGeminiDraftMessage(
        `草稿已產生；實際模型：${result.resolvedModel}${result.totalTokenCount ? `，共 ${result.totalTokenCount.toLocaleString('zh-TW')} tokens` : ''}。請先檢查，再套用到空白欄位。`,
      );
    } catch (error) {
      if (geminiAbortRef.current !== controller) return;
      setGeminiDraftHasError(true);
      setGeminiDraftMessage(error instanceof Error ? error.message : 'Gemini 履約草稿產生失敗。');
    } finally {
      if (geminiAbortRef.current === controller) {
        geminiAbortRef.current = null;
        setGeminiBusy(false);
      }
    }
  }

  function applyGeminiDraftToBlankFields() {
    if (!geminiDraft) return;
    if (geminiDraftIsStale) {
      setGeminiDraftHasError(true);
      setGeminiDraftMessage('案件內容在草稿產生後已變更。為避免套用過期內容，請重新產生草稿。');
      return;
    }

    const draft = geminiDraft.result.draft;
    const applied: string[] = [];
    if (!current.paymentTerms.trim() && draft.paymentTerms) applied.push('付款條件');
    if (!current.acceptanceMethod.trim() && draft.acceptanceMethod) applied.push('驗收方式');
    if (!current.vendorQualification.trim() && draft.vendorQualification) applied.push('廠商資格');
    if (!current.deliverables.length && draft.deliverables.length) applied.push('主要交付成果');
    if (!(current.pricingItems ?? []).length && draft.pricingItems.length) applied.push('標價清單工作項目');

    if (!applied.length) {
      setGeminiDraftHasError(false);
      setGeminiDraftMessage('本區欄位已有內容，因此沒有覆蓋任何資料；你仍可參考草稿後手動修改。');
      return;
    }

    setSaved(false);
    setTemplateWriteStatus('');
    setCurrent((prev) => {
      let next = normalizeProcurementCase(prev);
      if (!prev.paymentTerms.trim() && draft.paymentTerms) {
        next = updateCaseField(next, 'requirements.paymentTerms', { value: draft.paymentTerms, confirmed: false, sourceKind: 'ai' });
      }
      if (!prev.acceptanceMethod.trim() && draft.acceptanceMethod) {
        next = updateCaseField(next, 'requirements.acceptanceMethod', { value: draft.acceptanceMethod, confirmed: false, sourceKind: 'ai' });
      }
      if (!prev.vendorQualification.trim() && draft.vendorQualification) {
        next = updateCaseField(next, 'requirements.vendorQualification', { value: draft.vendorQualification, confirmed: false, sourceKind: 'ai' });
      }
      if (!prev.deliverables.length && draft.deliverables.length) {
        next = updateCaseField(next, 'requirements.deliverables', { value: [...draft.deliverables], confirmed: false, sourceKind: 'ai' });
      }
      if (!(prev.pricingItems ?? []).length && draft.pricingItems.length) {
        const generatedPricingItems = draft.pricingItems.map((item) => ({
          id: crypto.randomUUID(),
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
        }));
        next = updateCaseField(next, 'pricing.items', { value: generatedPricingItems, confirmed: false, sourceKind: 'ai' });
      }
      return next;
    });
    setGeminiDraft(null);
    setGeminiDraftHasError(false);
    setGeminiDraftMessage(`已套用：${applied.join('、')}。既有內容未覆蓋；預估單價仍由承辦人依市場資料填寫。`);
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
    if (!canFormalPackage) {
      const workflowBlocks = formalReadiness.blockingIssues.length;
      setTemplateWriteStatus(`完整招標文件包尚未就緒：文件一致性 ${preflight.blockers.length} 項、欄位確認 ${workflowBlocks} 項阻擋。請先處理系統警示與待確認欄位。`);
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
          <p className="eyebrow">GovProcure Assistant · MVP 0.2</p>
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
            <button className="secondary" onClick={beginNewCase}>＋ 新案件</button>
          </div>
          {cases.length === 0 ? (
            <p className="muted">目前沒有本機案件。</p>
          ) : (
            <div className="case-list">
              {cases.map((item) => (
                <div className={`case-item ${current.id === item.id ? 'active' : ''}`} key={item.id}>
                  <button className="case-open" onClick={() => openCase(item)}>
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

          <WorkflowStepper stage={workflowStage} />

          {workflowMessage && (
            <div className={`workflow-message ${workflowMessage.includes('尚未') || workflowMessage.includes('請處理') ? 'warning' : ''}`} role="status">
              {workflowMessage}
            </div>
          )}

          {isIntake && (
            <div className="card intake-card">
              <RequirementsIntake
                mode={intakeUiMode}
                fileResult={intakeFileResult}
                onModeChange={chooseIntakeMode}
                onFileValidated={(result) => {
                  setIntakeFileResult(result);
                  if (!result.ok) setLocalImportPreview(null);
                }}
                onLocalFileSelected={(file, result) => void parseSelectedRequirementFile(file, result)}
                onStartGuided={startGuidedRequirements}
                onConfirmUpload={confirmUploadedRequirement}
                onClearFile={() => { setIntakeFileResult(null); setLocalImportPreview(null); }}
                disabled={localImportPreview?.status === 'parsing'}
              />
              {localImportPreview?.status === 'parsing' && <p className="muted" role="status">正在本機解析，完成前不會離開此頁。</p>}
            </div>
          )}

          {isRequirementsReview && (
            <ImportedRequirementPreview
              source={workflowCase.sourceDocuments.at(-1)}
              preview={localImportPreview}
            />
          )}

          {isDocumentWorkflow && (
            <RequirementSummary
              title={current.title}
              agency={current.agency}
              description={current.description}
              deliverables={current.deliverables}
              onEdit={returnToRequirements}
            />
          )}

          {isRequirementsReview && <div className="card">
            <h2>1. 基本資料</h2>
            <div className="form-grid">
              <label>機關名稱<input value={current.agency} onChange={(e) => patch('agency', e.target.value)} placeholder="例如：○○縣政府" /></label>
              <label>案名<input value={current.title} onChange={(e) => patch('title', e.target.value)} placeholder="例如：115年度資訊系統維護案" /></label>
              <label>採購類型<select value={current.category} onChange={(e) => patch('category', e.target.value as ProcurementCategory)}><option value="unknown">不知道／稍後判斷</option><option value="service">勞務</option><option value="goods">財物</option><option value="construction">工程</option></select></label>
              <label>預算金額<input type="number" min="0" value={current.budget || ''} onChange={(e) => patch('budget', Number(e.target.value))} placeholder="980000" /></label>
              <label>履約開始<input type="date" value={current.contractStart || ''} onInput={(e) => patch('contractStart', e.currentTarget.value)} /></label>
              <label>履約結束<input type="date" value={current.contractEnd || ''} onInput={(e) => patch('contractEnd', e.currentTarget.value)} /></label>
            </div>
            <label>採購需求<textarea rows={5} value={current.description} onChange={(e) => patch('description', e.target.value)} placeholder="用白話描述要買什麼、委託什麼、希望廠商完成什麼。" /></label>
          </div>}

          {isDocumentWorkflow && <div className="card">
            <h2>2. 招標與決標設定</h2>
            <p className="muted">系統依金額級距與所選程序縮小後續選項，提供法源與建議；最終仍由承辦人依案件性質、機關層級及核准程序確認。</p>

            <div className="procurement-guidance">
              <div className="guidance-heading">
                <div>
                  <span className="eyebrow">規則版本：{PROCUREMENT_RULESET.effectiveFrom} 生效 · {PROCUREMENT_RULESET.verifiedOn} 核對</span>
                  <h3>{procurementGuidance.bandLabel}</h3>
                  <p>{procurementGuidance.bandSummary}</p>
                </div>
                <span className={`tag ${procurementGuidance.band === 'unset' ? 'untracked' : 'current'}`}>
                  {procurementGuidance.band === 'unset' ? '待填金額' : '已判斷級距'}
                </span>
              </div>
              <div className="recommendation-grid">
                <div><small>建議招標方式</small><strong>{procurementGuidance.recommended.procurementMethod || '待判斷'}</strong><p>{procurementGuidance.recommended.procurementMethodReason}</p></div>
                <div><small>建議決標原則</small><strong>{procurementGuidance.recommended.awardPrinciple || '須人工判斷'}</strong><p>{procurementGuidance.recommended.awardPrincipleReason}</p></div>
                <div><small>建議決標方式</small><strong>{procurementGuidance.recommended.awardMethod}</strong><p>{procurementGuidance.recommended.awardMethodReason}</p></div>
                <div><small>建議價金計算</small><strong>{procurementGuidance.recommended.contractPriceMethod || '待選採購類型'}</strong><p>{procurementGuidance.recommended.contractPriceMethodReason}</p></div>
              </div>
              <ul className="guidance-warnings">
                {procurementGuidance.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
              <p className="guidance-sources">
                官方依據：
                <a href={PROCUREMENT_RULESET.sources.thresholds} target="_blank" rel="noreferrer">採購金額門檻公告</a>
                <span>·</span>
                <a href={PROCUREMENT_RULESET.sources.procurementAct} target="_blank" rel="noreferrer">政府採購法</a>
                <span>·</span>
                <a href={PROCUREMENT_RULESET.sources.belowAnnouncementRules} target="_blank" rel="noreferrer">中央機關未達公告金額採購招標辦法</a>
              </p>
            </div>

            <div className="form-grid">
              <GuidedSelect
                label="招標方式"
                value={current.procurementMethod ?? ''}
                options={procurementGuidance.methodOptions}
                recommended={procurementGuidance.recommended.procurementMethod}
                onChange={(value) => patch('procurementMethod', value)}
                disabled={procurementGuidance.band === 'unset'}
              />
              <GuidedSelect
                label="決標原則"
                value={current.awardPrinciple ?? ''}
                options={procurementGuidance.awardPrincipleOptions}
                recommended={procurementGuidance.recommended.awardPrinciple}
                onChange={(value) => patch('awardPrinciple', value)}
                disabled={!current.procurementMethod}
              />
              <GuidedSelect
                label="決標方式"
                value={current.awardMethod ?? ''}
                options={procurementGuidance.awardMethodOptions}
                recommended={procurementGuidance.recommended.awardMethod}
                onChange={(value) => patch('awardMethod', value)}
                disabled={!current.awardPrinciple}
              />
              <GuidedSelect
                label="契約價金計算方式"
                value={current.contractPriceMethod ?? ''}
                options={procurementGuidance.contractPriceMethodOptions}
                recommended={procurementGuidance.recommended.contractPriceMethod}
                onChange={(value) => patch('contractPriceMethod', value)}
                disabled={current.category === 'unknown'}
              />
              <label>
                押標金
                <select value={current.bidBond ?? ''} onChange={(e) => patch('bidBond', e.target.value)}>
                  <option value="">請選擇並確認</option>
                  {workflowDefinitionById.get('decisions.bidBond')?.options?.map((option) => (
                    <option key={option.value} value={option.legacyValue ?? option.value}>{option.label}</option>
                  ))}
                </select>
                <small className="field-help">選擇收取後，系統會要求金額、方式及有效期。</small>
              </label>
              <label>
                履約保證金
                <select value={current.performanceBond ?? ''} onChange={(e) => patch('performanceBond', e.target.value)}>
                  <option value="">請選擇並確認</option>
                  {workflowDefinitionById.get('decisions.performanceBond')?.options?.map((option) => (
                    <option key={option.value} value={option.legacyValue ?? option.value}>{option.label}</option>
                  ))}
                </select>
                <small className="field-help">選擇收取後，系統會要求金額、形式及返還條件。</small>
              </label>
            </div>
          </div>}

          {isRequirementsReview && <div className="card">
            <div className="section-heading">
              <div>
                <h2>2. 需求內容、履約與驗收</h2>
                <p className="muted">Gemini 可依採購需求產生可編輯草稿；先預覽、再套用到空白欄位，不會覆蓋既有內容。</p>
              </div>
              <button className="ai-draft-button" disabled={geminiBusy} onClick={() => void generateEditableProcurementDraft()}>
                {geminiBusy ? 'Gemini 處理中…' : '✨ AI 產生履約與標價草稿'}
              </button>
            </div>
            <p className="ai-draft-safety">
              {geminiSelection ? `已連線 ${geminiSelection.selectedModel}` : '尚未驗證 Gemini Key；可在下方啟用，或完全不使用 AI。'}
              <span>AI 不會產生底價、預估單價、保額或法定招決標選項。</span>
            </p>
            {!geminiSelection && (
              <div className="requirements-ai-setup" aria-label="需求草稿 AI 設定">
                <div>
                  <strong>選用：以自己的 Gemini API Key 協助起草</strong>
                  <p>Key 只保存在目前分頁記憶體；驗證前不會傳送案件內容。</p>
                </div>
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
                    placeholder="輸入 Google AI Studio API Key"
                  />
                </label>
                <button disabled={geminiBusy || !geminiApiKey.trim()} onClick={() => void verifyGeminiApiKey()}>
                  {geminiBusy ? '驗證中…' : '驗證 Key'}
                </button>
                {geminiMessage && (
                  <p className={`gemini-status ${geminiHasError ? 'error' : ''}`} role="status">{geminiMessage}</p>
                )}
              </div>
            )}
            <div className="form-grid">
              <label>付款條件<input value={current.paymentTerms} onChange={(e) => patch('paymentTerms', e.target.value)} placeholder="例如：每季驗收合格後付款" /></label>
              <label>驗收方式<input value={current.acceptanceMethod} onChange={(e) => patch('acceptanceMethod', e.target.value)} placeholder="例如：成果報告＋功能測試" /></label>
            </div>
            <label>廠商資格<textarea rows={3} value={current.vendorQualification} onChange={(e) => patch('vendorQualification', e.target.value)} placeholder="尚未確認可先留白，系統會列入人工確認。" /></label>
            <label>主要交付成果<textarea rows={3} value={current.deliverables.join('\n')} onChange={(e) => patch('deliverables', e.target.value.split('\n').map((v) => v.trim()).filter(Boolean))} placeholder={'每行一項，例如：\n每月維護報告\n系統備份紀錄'} /></label>

            {geminiDraftMessage && (
              <p className={`gemini-status ${geminiDraftHasError ? 'error' : geminiDraft ? 'success' : ''}`} role="status">
                {geminiDraftMessage}
              </p>
            )}

            {geminiDraft && (
              <div className={`ai-draft-preview ${geminiDraftIsStale ? 'stale' : ''}`}>
                <div className="ai-draft-preview-heading">
                  <div>
                    <h3>Gemini 履約草稿</h3>
                    <p>{geminiDraft.result.requestedModel} → {geminiDraft.result.resolvedModel}</p>
                  </div>
                  <span className={`tag ${geminiDraftIsStale ? 'candidate' : 'current'}`}>{geminiDraftIsStale ? '案件已變更' : '待人工套用'}</span>
                </div>
                {geminiDraftIsStale && <div className="notice warning">案件內容已在草稿產生後變更；請重新產生，避免套用過期建議。</div>}
                <div className="ai-draft-field-grid">
                  <div><strong>付款條件</strong><p>{geminiDraft.result.draft.paymentTerms || '未提供'}</p></div>
                  <div><strong>驗收方式</strong><p>{geminiDraft.result.draft.acceptanceMethod || '未提供'}</p></div>
                  <div><strong>廠商資格</strong><p>{geminiDraft.result.draft.vendorQualification || '未提供'}</p></div>
                </div>
                <div className="ai-draft-columns">
                  <div>
                    <strong>主要交付成果</strong>
                    <ol>{geminiDraft.result.draft.deliverables.map((item) => <li key={item}>{item}</li>)}</ol>
                  </div>
                  <div>
                    <strong>標價清單工作項目</strong>
                    <div className="draft-pricing-list">
                      {geminiDraft.result.draft.pricingItems.map((item, index) => (
                        <div key={`${item.description}-${index}`}>
                          <span>{index + 1}. {item.description}</span>
                          <small>{item.quantity ?? '待填'} {item.unit || '單位待填'}{item.note ? ` · ${item.note}` : ''}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {geminiDraft.result.draft.warnings.length > 0 && (
                  <div className="notice warning">
                    <strong>AI 標記的待確認事項</strong>
                    <ul>{geminiDraft.result.draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </div>
                )}
                <div className="ai-draft-actions">
                  <button disabled={geminiDraftIsStale} onClick={applyGeminiDraftToBlankFields}>套用到空白欄位</button>
                  <button className="secondary" onClick={() => { setGeminiDraft(null); setGeminiDraftMessage('已取消本次 AI 草稿。'); setGeminiDraftHasError(false); }}>取消草稿</button>
                </div>
                <p className="ai-disclaimer">套用後仍是一般表單欄位，可由使用者逐項修改；既有欄位與內部預估單價不會被覆蓋。</p>
              </div>
            )}

            <div className="pricing-section">
              <div className="pricing-heading">
                <div>
                  <h3>標價清單工作項目</h3>
                  <p className="muted">可由交付成果或 AI 草稿建立項目；AI 建議的數量與單位須人工確認。預估單價屬內部市場調查，不會外送 AI，也不會帶入對外 XLSX。</p>
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
          </div>}

          {isRequirementsReview && (
            <div className="card requirement-confirmation-card">
              <FieldReadinessPanel
                title="需求欄位檢核"
                description="必填欄位要有內容、通過格式檢查並由您確認；AI或上傳擷取內容不會自動算完成。"
                report={requirementsReadiness}
                definitions={requirementFieldDefinitions}
              />
              <div className="stage-actions">
                <button className="secondary" onClick={beginNewCase}>
                  回到需求入口
                </button>
                <button onClick={confirmRequirementsAndContinue}>確認需求並進入採購決策</button>
              </div>
            </div>
          )}

          {isDocumentWorkflow && (
            <div className="card conditional-fields-card">
              <div className="section-heading">
                <div>
                  <h2>3. 條件必填與契約風險</h2>
                  <p className="muted">系統依前面的選項展開後續欄位；未適用者不會阻擋，適用者必須填寫並確認。</p>
                </div>
                <span className={`tag ${decisionReadiness.ready ? 'current' : 'candidate'}`}>
                  {decisionReadiness.ready ? '本區已確認' : `${decisionReadiness.blockingIssues.length} 項待處理`}
                </span>
              </div>

              <div className="conditional-field-list">
                {workflowFieldIsApplicable('decisions.evaluationDetails') && (
                  <label>
                    評審／評選設定 <span className="required-label">條件必填</span>
                    <textarea
                      rows={4}
                      value={String(workflowFieldValue('decisions.evaluationDetails') ?? '')}
                      onChange={(event) => patchWorkflowField('decisions.evaluationDetails', event.target.value)}
                      placeholder="評審項目與配分、及格門檻、價格是否納入、最優勝與同分處理方式"
                    />
                    <small className="field-help">{workflowDefinitionById.get('decisions.evaluationDetails')?.helpText}</small>
                  </label>
                )}

                {workflowFieldIsApplicable('decisions.bidBondDetails') && (
                  <label>
                    押標金細節 <span className="required-label">條件必填</span>
                    <textarea
                      rows={3}
                      value={String(workflowFieldValue('decisions.bidBondDetails') ?? '')}
                      onChange={(event) => patchWorkflowField('decisions.bidBondDetails', event.target.value)}
                      placeholder="金額或比例、繳納方式、有效期間及退還條件"
                    />
                  </label>
                )}

                {workflowFieldIsApplicable('decisions.performanceBondDetails') && (
                  <label>
                    履約保證金細節 <span className="required-label">條件必填</span>
                    <textarea
                      rows={3}
                      value={String(workflowFieldValue('decisions.performanceBondDetails') ?? '')}
                      onChange={(event) => patchWorkflowField('decisions.performanceBondDetails', event.target.value)}
                      placeholder="金額或比例、繳納形式、有效期間及返還時點"
                    />
                  </label>
                )}

                {workflowFieldIsApplicable('contract.insuranceRequired') && (
                  <label>
                    保險需求 <span className="required-label">條件必填</span>
                    <select
                      value={String(workflowFieldValue('contract.insuranceRequired') ?? '')}
                      onChange={(event) => patchWorkflowField('contract.insuranceRequired', event.target.value)}
                    >
                      <option value="">請依案件風險選擇</option>
                      {workflowDefinitionById.get('contract.insuranceRequired')?.options?.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}｜{option.description}</option>
                      ))}
                    </select>
                    <small className="field-help">活動、人員派遣、旅行安排或部分施工會影響適用險種。</small>
                  </label>
                )}

                {workflowFieldIsApplicable('contract.insuranceTypes') && (
                  <label>
                    保險種類、保額與期間 <span className="required-label">條件必填</span>
                    <textarea
                      rows={4}
                      value={String(workflowFieldValue('contract.insuranceTypes') ?? '')}
                      onChange={(event) => patchWorkflowField('contract.insuranceTypes', event.target.value)}
                      placeholder="例如：公共意外責任保險；每人、每事故及保險期間累計保額；自負額；保險期間；投保證明"
                    />
                  </label>
                )}

                {workflowFieldIsApplicable('contract.insuranceWaiverReason') && (
                  <label>
                    不要求保險的風險評估與理由 <span className="required-label">條件必填</span>
                    <textarea
                      rows={3}
                      value={String(workflowFieldValue('contract.insuranceWaiverReason') ?? '')}
                      onChange={(event) => patchWorkflowField('contract.insuranceWaiverReason', event.target.value)}
                      placeholder="說明本案風險、既有保障或其他不要求廠商另行投保的理由"
                    />
                  </label>
                )}

                {workflowFieldIsApplicable('contract.ipRights') && (
                  <label>
                    智慧財產權與成果使用 <span className="required-label">條件必填</span>
                    <textarea
                      rows={4}
                      value={String(workflowFieldValue('contract.ipRights') ?? '')}
                      onChange={(event) => patchWorkflowField('contract.ipRights', event.target.value)}
                      placeholder="說明著作權歸屬、機關使用／修改／再授權範圍、第三人素材與原始檔交付"
                    />
                  </label>
                )}

                {workflowFieldIsApplicable('contract.confidentiality') && (
                  <label>
                    保密、個資與資訊安全 <span className="required-label">條件必填</span>
                    <textarea
                      rows={4}
                      value={String(workflowFieldValue('contract.confidentiality') ?? '')}
                      onChange={(event) => patchWorkflowField('contract.confidentiality', event.target.value)}
                      placeholder="資料範圍、存取權限、保存與刪除、事故通報、保密切結與稽核方式"
                    />
                  </label>
                )}
              </div>

              <FieldReadinessPanel
                title="採購與契約欄位檢核"
                description="每個適用選項都要有正式值；修改後會回到待確認狀態。"
                report={decisionReadiness}
                definitions={decisionFieldDefinitions}
              />
              <div className="stage-actions">
                <button onClick={confirmProcurementAndContractSettings}>確認本區設定</button>
              </div>
            </div>
          )}

          {isDocumentWorkflow && <div className="card security-card">
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
          </div>}

          {isDocumentWorkflow && <>
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
            <p className="muted">PCC Watcher 會監測公開索引，並另外封存核心範本的 Word / ODT / PDF 與 SHA-256。偵測到新版時會建立 GitHub candidate PR；維護者完成差異審查後，再從 GitHub 執行升版流程建立 active PR。本站只顯示狀態，不會直接修改正式範本。</p>
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
                      {observed?.detailUrl && <small><a href={observed.detailUrl} target="_blank" rel="noreferrer">查看工程會官方版本頁</a></small>}
                    </span>
                    <span className="template-status-actions">
                      <span className={`tag ${syncStatus}`}>{syncLabels[syncStatus]}</span>
                      {syncStatus === 'candidate' && (
                        <a className="registry-review-link" href={PCC_CANDIDATE_PULL_REQUESTS_URL} target="_blank" rel="noreferrer">
                          查看 GitHub 審查紀錄
                        </a>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="registry-source registry-links">
              <span>監測來源：<a href={pccTemplateIndex.sourceUrl} target="_blank" rel="noreferrer">工程會「招標相關文件及表格」</a></span>
              <span>·</span>
              <a href={PCC_CANDIDATE_PULL_REQUESTS_URL} target="_blank" rel="noreferrer">候選版本 PR／紀錄</a>
              <span>·</span>
              <a href={PCC_TEMPLATE_WATCHER_ACTIONS_URL} target="_blank" rel="noreferrer">Watcher 執行紀錄</a>
              <span>·</span>
              <a href={PCC_TEMPLATE_PROMOTION_ACTIONS_URL} target="_blank" rel="noreferrer">升版 active</a>
            </p>
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
                disabled={!canFormalPackage}
                onClick={() => void exportCompletePackage()}
                title={canFormalPackage
                  ? '欄位確認與跨文件檢核均已通過'
                  : `欄位 ${formalReadiness.blockingIssues.length} 項、文件 ${preflight.blockers.length} 項阻擋`}
              >
                一鍵下載完整招標文件包 ZIP
              </button>
            )}
            {current.category === 'service' && (
              <p className={`package-readiness ${canFormalPackage ? 'ready' : 'blocked'}`}>
                {canFormalPackage
                  ? `整包輸出就緒｜${preflight.warnings.length} 項非阻擋提醒`
                  : `整包輸出未就緒｜欄位 ${formalReadiness.blockingIssues.length} 項、文件 ${preflight.blockers.length} 項阻擋，${preflight.warnings.length} 項提醒`}
              </p>
            )}
            {templateWriteStatus && <p className="template-write-status">{templateWriteStatus}</p>}
          </div>
          </>}
        </section>
      </main>
    </div>
  );
}
