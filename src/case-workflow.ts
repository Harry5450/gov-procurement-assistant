import {
  getFieldDefinition,
  getFieldDefinitions,
  getLegacyFieldValue,
  isFieldApplicable,
  isFieldValuePresent,
  ordinaryServiceFieldRegistry,
  toLegacyFieldValue,
  toStableFieldValue,
} from './field-registry.ts';
import type {
  CaseFieldValue,
  DecisionAnswer,
  FieldDefinition,
  FieldSourceKind,
  FieldValue,
  FieldValueState,
  IntakeMode,
  ProcurementCase,
  ProcurementCaseV2,
  ProcurementCategory,
  PricingItem,
  SourceDocument,
  SourceDocumentFormat,
  SourceDocumentStatus,
  WorkflowStage,
} from './types';

const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  'intake',
  'requirements-review',
  'procurement-decisions',
  'tender-draft',
  'contract-draft',
  'review',
  'exported',
];

const INTAKE_MODES: readonly IntakeMode[] = ['guided', 'upload', 'hybrid', 'legacy'];
const FIELD_STATES: readonly FieldValueState[] = [
  'missing',
  'provided',
  'defaulted',
  'not-applicable',
  'waived',
  'unknown',
  'conflict',
];
const SOURCE_KINDS: readonly FieldSourceKind[] = [
  'user',
  'upload',
  'ai',
  'derived',
  'template-default',
  'legacy',
  'system',
];
const DOCUMENT_FORMATS: readonly SourceDocumentFormat[] = ['docx', 'doc', 'odt', 'pdf', 'xlsx', 'other'];
const DOCUMENT_STATUSES: readonly SourceDocumentStatus[] = ['uploaded', 'parsed', 'needs-review', 'failed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFieldState(value: unknown): value is FieldValueState {
  return typeof value === 'string' && FIELD_STATES.includes(value as FieldValueState);
}

function isSourceKind(value: unknown): value is FieldSourceKind {
  return typeof value === 'string' && SOURCE_KINDS.includes(value as FieldSourceKind);
}

function isProcurementCategory(value: unknown): value is ProcurementCategory {
  return value === 'service' || value === 'goods' || value === 'construction' || value === 'unknown';
}

function isWorkflowStage(value: unknown): value is WorkflowStage {
  return typeof value === 'string' && WORKFLOW_STAGES.includes(value as WorkflowStage);
}

function isIntakeMode(value: unknown): value is IntakeMode {
  return typeof value === 'string' && INTAKE_MODES.includes(value as IntakeMode);
}

function isDocumentFormat(value: unknown): value is SourceDocumentFormat {
  return typeof value === 'string' && DOCUMENT_FORMATS.includes(value as SourceDocumentFormat);
}

function isDocumentStatus(value: unknown): value is SourceDocumentStatus {
  return typeof value === 'string' && DOCUMENT_STATUSES.includes(value as SourceDocumentStatus);
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function timestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return Number.isFinite(Date.parse(value)) ? value : fallback;
}

function validFieldValue(value: unknown): value is CaseFieldValue {
  return isRecord(value) && typeof value.confirmed === 'boolean' && isFieldState(value.state);
}

function normalizedSource(source: unknown): FieldValue<unknown>['source'] | undefined {
  if (!isRecord(source) || !isSourceKind(source.kind)) return undefined;
  const locator = isRecord(source.locator)
    ? {
        ...(typeof source.locator.page === 'number' ? { page: source.locator.page } : {}),
        ...(typeof source.locator.section === 'string' ? { section: source.locator.section } : {}),
        ...(typeof source.locator.paragraph === 'number' ? { paragraph: source.locator.paragraph } : {}),
        ...(typeof source.locator.excerpt === 'string' ? { excerpt: source.locator.excerpt.slice(0, 500) } : {}),
      }
    : undefined;
  return {
    kind: source.kind,
    ...(typeof source.documentId === 'string' ? { documentId: source.documentId } : {}),
    ...(locator ? { locator } : {}),
    ...(typeof source.confidence === 'number' && Number.isFinite(source.confidence)
      ? { confidence: Math.max(0, Math.min(1, source.confidence)) }
      : {}),
    ...(typeof source.note === 'string' ? { note: source.note.slice(0, 1000) } : {}),
  };
}

function normalizeFieldValue(
  value: unknown,
  now: string,
  definition?: FieldDefinition,
): CaseFieldValue | undefined {
  if (!validFieldValue(value)) return undefined;
  const state = value.state;
  const source = normalizedSource(value.source);
  const stableValue = Object.prototype.hasOwnProperty.call(value, 'value')
    ? toStableFieldValue(definition?.id ?? '', value.value)
    : undefined;
  const normalized: CaseFieldValue = {
    ...(Object.prototype.hasOwnProperty.call(value, 'value') ? { value: stableValue } : {}),
    state,
    confirmed: value.confirmed,
    ...(typeof value.naReason === 'string' ? { naReason: value.naReason.slice(0, 1000) } : {}),
    ...(typeof value.rationale === 'string' ? { rationale: value.rationale.slice(0, 2000) } : {}),
    ...(source ? { source } : {}),
    updatedAt: timestamp(value.updatedAt, now),
  };
  return normalized;
}

function normalizePricingItems(value: unknown): PricingItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter(isRecord)
    .map((item, index): PricingItem | undefined => {
      const description = text(item.description).trim();
      if (!description) return undefined;
      return {
        id: text(item.id, `item-${index + 1}`),
        description,
        ...(typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? { quantity: item.quantity } : {}),
        ...(typeof item.unit === 'string' && item.unit.trim() ? { unit: item.unit.trim() } : {}),
        ...(typeof item.estimatedUnitPrice === 'number' && Number.isFinite(item.estimatedUnitPrice)
          ? { estimatedUnitPrice: item.estimatedUnitPrice }
          : {}),
        ...(typeof item.note === 'string' && item.note.trim() ? { note: item.note.trim() } : {}),
      };
    })
    .filter((item): item is PricingItem => Boolean(item));
  return items.length > 0 ? items : undefined;
}

function normalizeSourceDocument(value: unknown, now: string): SourceDocument | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id).trim();
  const name = text(value.name || value.fileName).trim();
  const fileName = text(value.fileName || value.name).trim();
  if (!id || !name || !fileName || !isDocumentFormat(value.format) || !isDocumentStatus(value.status)) return undefined;
  return {
    id,
    name,
    fileName,
    format: value.format,
    ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
    ...(typeof value.sizeBytes === 'number' && Number.isFinite(value.sizeBytes) ? { sizeBytes: value.sizeBytes } : {}),
    ...(typeof value.sha256 === 'string' && value.sha256.trim() ? { sha256: value.sha256.trim() } : {}),
    importedAt: timestamp(value.importedAt, now),
    status: value.status,
    // Uploaded source bytes are never part of the case record and remain
    // browser-local.  A malformed/imported `false` flag must not weaken that
    // privacy boundary during migration.
    localOnly: true,
    ...(typeof value.pageCount === 'number' && Number.isFinite(value.pageCount) ? { pageCount: value.pageCount } : {}),
    ...(typeof value.parserVersion === 'string' ? { parserVersion: value.parserVersion } : {}),
    ...(typeof value.error === 'string' ? { error: value.error.slice(0, 2000) } : {}),
  };
}

function sourceForMigration(): CaseFieldValue['source'] {
  return {
    kind: 'legacy',
    note: '由既有案件欄位安全遷移；請在需求確認階段重新檢視。',
  };
}

function missingField(now: string): CaseFieldValue {
  return {
    state: 'missing',
    confirmed: false,
    source: { kind: 'system', note: '尚未提供資料。' },
    updatedAt: now,
  };
}

function fieldFromLegacy(value: unknown, now: string, definition?: FieldDefinition): CaseFieldValue {
  if (!isFieldValuePresent(value)) return missingField(now);
  return {
    value: toStableFieldValue(definition?.id ?? '', value),
    state: 'provided',
    // Existing top-level values were already entered by a human in the old
    // form.  Preserve usability while retaining an auditable legacy source.
    confirmed: true,
    source: sourceForMigration(),
    updatedAt: now,
  };
}

function normalizeDecisions(
  input: unknown,
  fields: Record<string, CaseFieldValue>,
  now: string,
): Record<string, DecisionAnswer> | undefined {
  const decisions: Record<string, DecisionAnswer> = {};
  if (isRecord(input)) {
    for (const [fieldId, value] of Object.entries(input)) {
      if (!validFieldValue(value)) continue;
      decisions[fieldId] = {
        ...normalizeFieldValue(value, now, getFieldDefinition(fieldId))!,
        fieldId,
      } as DecisionAnswer;
    }
  }
  for (const definition of ordinaryServiceFieldRegistry) {
    if (definition.section !== 'decisions') continue;
    const value = fields[definition.id];
    if (!decisions[definition.id] && value) {
      decisions[definition.id] = { ...value, fieldId: definition.id } as DecisionAnswer;
    }
  }
  return Object.keys(decisions).length > 0 ? decisions : undefined;
}

/**
 * Convert an old flat case or an already-v2 case into the complete v2 shape.
 * It intentionally does not call Dexie or any AI API; timestamps are assigned
 * only to metadata that was absent from the input.
 */
export function normalizeProcurementCase(input: Partial<ProcurementCase>): ProcurementCaseV2 {
  const now = new Date().toISOString();
  const createdAt = timestamp(input.createdAt, now);
  const updatedAt = timestamp(input.updatedAt, createdAt);
  const pricingItems = normalizePricingItems(input.pricingItems);
  const sourceInput = Array.isArray(input.sourceDocuments) ? input.sourceDocuments : [];
  const sourceDocuments = sourceInput
    .map((source) => normalizeSourceDocument(source, now))
    .filter((source): source is SourceDocument => Boolean(source));

  const base = {
    ...input,
    id: text(input.id, `case-${Date.now()}`),
    title: text(input.title),
    agency: text(input.agency),
    category: isProcurementCategory(input.category) ? input.category : 'unknown',
    budget: finiteNumber(input.budget),
    description: text(input.description),
    ...(typeof input.contractStart === 'string' ? { contractStart: input.contractStart } : {}),
    ...(typeof input.contractEnd === 'string' ? { contractEnd: input.contractEnd } : {}),
    paymentTerms: text(input.paymentTerms),
    acceptanceMethod: text(input.acceptanceMethod),
    deliverables: Array.isArray(input.deliverables)
      ? input.deliverables.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : [],
    ...(pricingItems ? { pricingItems } : {}),
    vendorQualification: text(input.vendorQualification),
    internalNotes: text(input.internalNotes),
    ...(typeof input.reservePrice === 'number' && Number.isFinite(input.reservePrice)
      ? { reservePrice: input.reservePrice }
      : {}),
    securityLevel:
      input.securityLevel === 'PUBLIC' ||
      input.securityLevel === 'INTERNAL' ||
      input.securityLevel === 'SENSITIVE' ||
      input.securityLevel === 'RESTRICTED'
        ? input.securityLevel
        : 'PUBLIC',
    createdAt,
    updatedAt,
  } satisfies Omit<ProcurementCase, 'id' | 'title' | 'agency' | 'category' | 'budget' | 'description' | 'paymentTerms' | 'acceptanceMethod' | 'deliverables' | 'vendorQualification' | 'internalNotes' | 'securityLevel' | 'createdAt' | 'updatedAt'> & {
    id: string;
    title: string;
    agency: string;
    category: ProcurementCategory;
    budget: number;
    description: string;
    paymentTerms: string;
    acceptanceMethod: string;
    deliverables: string[];
    vendorQualification: string;
    internalNotes: string;
    securityLevel: ProcurementCase['securityLevel'];
    createdAt: string;
    updatedAt: string;
  };

  const fields: Record<string, CaseFieldValue> = {};
  const inputFields = isRecord(input.fields) ? input.fields : {};
  for (const definition of ordinaryServiceFieldRegistry) {
    const existing = normalizeFieldValue(inputFields[definition.id], now, definition);
    fields[definition.id] = existing ?? fieldFromLegacy(getLegacyFieldValue(input as ProcurementCase, definition), now, definition);
  }
  // Preserve custom fields created by later workflow modules without allowing
  // malformed objects into the v2 map.
  for (const [fieldId, value] of Object.entries(inputFields)) {
    if (!fields[fieldId]) {
      const normalized = normalizeFieldValue(value, now);
      if (normalized) fields[fieldId] = normalized;
    }
  }

  // Treat the v2 field map as canonical while keeping the legacy flat shape
  // in sync for existing writers.  This also lets cross-field validators use
  // values supplied solely by a new v2 editor (without requiring duplicate
  // manual updates to the legacy properties).
  const mirroredBase = { ...base };
  for (const definition of ordinaryServiceFieldRegistry) {
    if (!definition.legacyKey) continue;
    const field = fields[definition.id];
    if (!field || !isFieldValuePresent(field.value)) continue;
    if (field.state !== 'provided' && field.state !== 'defaulted') continue;
    (mirroredBase as unknown as Record<string, unknown>)[definition.legacyKey] = toLegacyFieldValue(
      definition.id,
      field.value,
    );
  }

  // A v1/legacy case already has its basic facts entered; returning it to the
  // new-intake screen would make the migration appear to lose progress.  Only
  // an explicitly v2 case with a blank stage starts at intake.
  const workflowStage = isWorkflowStage(input.workflowStage)
    ? input.workflowStage
    : input.schemaVersion === 2
      ? 'intake'
      : 'procurement-decisions';
  const intakeMode = isIntakeMode(input.intakeMode)
    ? input.intakeMode
    : input.schemaVersion === 2
      ? 'guided'
      : 'legacy';

  return {
    ...mirroredBase,
    schemaVersion: 2,
    workflowStage,
    intakeMode,
    fields,
    ...(normalizeDecisions(input.decisions, fields, now) ? { decisions: normalizeDecisions(input.decisions, fields, now) } : {}),
    sourceDocuments,
  } as ProcurementCaseV2;
}

export interface FieldReadiness {
  fieldId: string;
  label: string;
  requirement: FieldDefinition['requirement'];
  applicable: boolean;
  status: 'resolved' | 'not-applicable' | 'missing' | 'needs-confirmation' | 'invalid' | 'optional';
  value?: unknown;
  message?: string;
}

export interface CaseReadinessReport {
  ready: boolean;
  score: number;
  applicableRequired: number;
  resolvedRequired: number;
  fields: FieldReadiness[];
  blockingIssues: FieldReadiness[];
  warnings: FieldReadiness[];
}

function assessField(definition: FieldDefinition, procurementCase: ProcurementCaseV2): FieldReadiness {
  const field = procurementCase.fields[definition.id];
  const applicable = isFieldApplicable(definition, procurementCase);
  if (!applicable) {
    return {
      fieldId: definition.id,
      label: definition.label,
      requirement: definition.requirement,
      applicable: false,
      status: 'not-applicable',
      message: '依目前案件條件不適用；如情況改變，請重新檢查此欄位。',
    };
  }

  if (definition.requirement === 'optional') {
    if (!field || field.state === 'missing') {
      return {
        fieldId: definition.id,
        label: definition.label,
        requirement: definition.requirement,
        applicable: true,
        status: 'optional',
        message: '選填欄位，可留白。',
      };
    }
    if (!field.confirmed) {
      return {
        fieldId: definition.id,
        label: definition.label,
        requirement: definition.requirement,
        applicable: true,
        status: 'optional',
        value: field.value,
        message: '已提供但尚未由使用者確認。',
      };
    }
    return {
      fieldId: definition.id,
      label: definition.label,
      requirement: definition.requirement,
      applicable: true,
      status: 'optional',
      value: field.value,
    };
  }

  if (!field) {
    return {
      fieldId: definition.id,
      label: definition.label,
      requirement: definition.requirement,
      applicable: true,
      status: 'missing',
      message: '必填欄位尚未提供資料。',
    };
  }

  if (field.state === 'unknown' || field.state === 'conflict') {
    return {
      fieldId: definition.id,
      label: definition.label,
      requirement: definition.requirement,
      applicable: true,
      status: 'invalid',
      value: field.value,
      message: field.state === 'conflict' ? '來源之間有衝突，請選定一個正式值。' : '來源不明，請人工確認。',
    };
  }

  if (field.state === 'not-applicable' || field.state === 'waived') {
    const hasReason = Boolean(field.naReason?.trim());
    return {
      fieldId: definition.id,
      label: definition.label,
      requirement: definition.requirement,
      applicable: true,
      status: hasReason && field.confirmed ? 'resolved' : 'needs-confirmation',
      value: field.value,
      message: hasReason ? '已填寫不適用／豁免理由。' : '不適用或豁免必須填寫理由並確認。',
    };
  }

  if (field.state === 'missing' || !isFieldValuePresent(field.value)) {
    return {
      fieldId: definition.id,
      label: definition.label,
      requirement: definition.requirement,
      applicable: true,
      status: 'missing',
      message: '必填欄位尚未提供資料。',
    };
  }

  if (
    definition.options &&
    typeof field.value === 'string' &&
    !definition.options.some((option) => option.value === field.value)
  ) {
    return {
      fieldId: definition.id,
      label: definition.label,
      requirement: definition.requirement,
      applicable: true,
      status: 'invalid',
      value: field.value,
      message: '目前值不在此版本的允許選項中，請重新選擇並確認。',
    };
  }

  const validationMessage = definition.validate?.(field.value, procurementCase);
  if (validationMessage) {
    return {
      fieldId: definition.id,
      label: definition.label,
      requirement: definition.requirement,
      applicable: true,
      status: 'invalid',
      value: field.value,
      message: validationMessage,
    };
  }

  if (!field.confirmed) {
    return {
      fieldId: definition.id,
      label: definition.label,
      requirement: definition.requirement,
      applicable: true,
      status: 'needs-confirmation',
      value: field.value,
      message: '資料已提供，但仍待使用者確認。',
    };
  }

  return {
    fieldId: definition.id,
    label: definition.label,
    requirement: definition.requirement,
    applicable: true,
    status: 'resolved',
    value: field.value,
  };
}

/** Deterministic formal-export gate for the configured field registry. */
export function evaluateCaseReadiness(
  procurementCase: ProcurementCase,
  definitions: readonly FieldDefinition[] = ordinaryServiceFieldRegistry,
): CaseReadinessReport {
  const normalized = normalizeProcurementCase(procurementCase);
  const fields = definitions.map((definition) => assessField(definition, normalized));
  const requiredFields = fields.filter(
    (field) => field.applicable && field.requirement !== 'optional',
  );
  const resolvedRequired = requiredFields.filter((field) => field.status === 'resolved').length;
  const blockingIssues = requiredFields.filter((field) => field.status !== 'resolved');
  const warnings = fields.filter(
    (field) => field.status === 'optional' && field.message && field.message !== '選填欄位，可留白。',
  );
  return {
    ready: blockingIssues.length === 0,
    score: requiredFields.length === 0 ? 100 : Math.round((resolvedRequired / requiredFields.length) * 100),
    applicableRequired: requiredFields.length,
    resolvedRequired,
    fields,
    blockingIssues,
    warnings,
  };
}

export function canExportCase(procurementCase: ProcurementCase): boolean {
  return evaluateCaseReadiness(procurementCase).ready;
}

export interface CaseFieldUpdate {
  value?: unknown;
  state?: FieldValueState;
  confirmed?: boolean;
  naReason?: string;
  rationale?: string;
  sourceKind?: FieldSourceKind;
  source?: CaseFieldValue['source'];
}

/**
 * Pure field update helper.  It mirrors known legacy properties so existing
 * document writers immediately see values edited by the v2 UI.
 */
export function updateCaseField(
  procurementCase: ProcurementCase,
  fieldId: string,
  update: CaseFieldUpdate,
): ProcurementCaseV2 {
  const normalized = normalizeProcurementCase(procurementCase);
  const current = normalized.fields[fieldId];
  const definition = getFieldDefinition(fieldId);
  const now = new Date().toISOString();
  const stableValue = Object.prototype.hasOwnProperty.call(update, 'value')
    ? toStableFieldValue(fieldId, update.value)
    : current?.value;
  const hasValue = Object.prototype.hasOwnProperty.call(update, 'value')
    ? isFieldValuePresent(stableValue)
    : Boolean(current && isFieldValuePresent(current.value));
  const nextState = update.state
    ?? (!Object.prototype.hasOwnProperty.call(update, 'value') && current
      ? current.state
      : hasValue
        ? 'provided'
        : 'missing');
  // A changed value is a human edit unless the caller supplies another source
  // kind.  A confirmation-only update may retain upload/AI provenance so the
  // audit trail still explains where the accepted suggestion originated.
  const source = update.source
    ?? (update.sourceKind
      ? { kind: update.sourceKind }
      : Object.prototype.hasOwnProperty.call(update, 'value')
        ? { kind: 'user' }
        : current?.source ?? { kind: 'user' });
  const nextField: CaseFieldValue = {
    ...(Object.prototype.hasOwnProperty.call(update, 'value')
      ? { value: stableValue }
      : current?.value !== undefined
        ? { value: current.value }
        : {}),
    state: nextState,
    confirmed: update.confirmed ?? false,
    ...(update.naReason !== undefined ? { naReason: update.naReason } : current?.naReason ? { naReason: current.naReason } : {}),
    ...(update.rationale !== undefined ? { rationale: update.rationale } : current?.rationale ? { rationale: current.rationale } : {}),
    source,
    updatedAt: now,
  };
  const next: ProcurementCaseV2 = {
    ...normalized,
    fields: { ...normalized.fields, [fieldId]: nextField },
    updatedAt: now,
  };
  if (definition?.legacyKey) {
    const legacyKey = definition.legacyKey;
    if (Object.prototype.hasOwnProperty.call(update, 'value')) {
      (next as unknown as Record<string, unknown>)[legacyKey] = toLegacyFieldValue(fieldId, stableValue);
    }
  }
  if (definition?.section === 'decisions') {
    next.decisions = {
      ...(next.decisions ?? {}),
      [fieldId]: { ...nextField, fieldId } as DecisionAnswer,
    };
  }
  return next;
}

export function getWorkflowStageLabel(stage: WorkflowStage): string {
  const labels: Record<WorkflowStage, string> = {
    intake: '建立案件',
    'requirements-review': '確認需求',
    'procurement-decisions': '採購決策',
    'tender-draft': '投標須知',
    'contract-draft': '契約草稿',
    review: '正式檢查',
    exported: '已匯出',
  };
  return labels[stage];
}

export function getFieldProgress(procurementCase: ProcurementCase): {
  completed: number;
  total: number;
  percentage: number;
} {
  const report = evaluateCaseReadiness(procurementCase);
  return {
    completed: report.resolvedRequired,
    total: report.applicableRequired,
    percentage: report.score,
  };
}

export function getWorkflowFieldDefinitions(section?: FieldDefinition['section']): FieldDefinition[] {
  return getFieldDefinitions(section);
}
