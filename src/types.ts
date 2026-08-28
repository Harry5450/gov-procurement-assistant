export type ProcurementCategory = 'service' | 'goods' | 'construction' | 'unknown';
export type SecurityLevel = 'PUBLIC' | 'INTERNAL' | 'SENSITIVE' | 'RESTRICTED';

/**
 * The workflow is deliberately independent from the document writers.  Old
 * cases can continue to be rendered by the writers while new cases move
 * through the guided intake and review checkpoints.
 */
export type WorkflowStage =
  | 'intake'
  | 'requirements-review'
  | 'procurement-decisions'
  | 'tender-draft'
  | 'contract-draft'
  | 'review'
  | 'exported';

export type IntakeMode = 'guided' | 'upload' | 'hybrid' | 'legacy';

export type FieldValueState =
  | 'missing'
  | 'provided'
  | 'defaulted'
  | 'not-applicable'
  | 'waived'
  | 'unknown'
  | 'conflict';

/** A field may be mandatory only after its applicability predicate is true. */
export type FieldRequirement = 'required' | 'conditional' | 'defaulted' | 'optional';

export type FieldSection = 'requirements' | 'decisions' | 'tender' | 'contract' | 'pricing';
export type FieldDataType =
  | 'text'
  | 'multiline'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'deliverables'
  | 'pricing-items';

export interface FieldOption {
  value: string;
  /** Value understood by the existing document writers/legacy flat model. */
  legacyValue?: string;
  label: string;
  description: string;
  recommendation?: string;
  legalBasis?: string;
}

export type FieldSourceKind =
  | 'user'
  | 'upload'
  | 'ai'
  | 'derived'
  | 'template-default'
  | 'legacy'
  | 'system';

export interface SourceLocator {
  page?: number;
  section?: string;
  paragraph?: number;
  /** A short, user-visible excerpt; never the full source document. */
  excerpt?: string;
}

export interface FieldSourceRef {
  kind: FieldSourceKind;
  documentId?: string;
  locator?: SourceLocator;
  confidence?: number;
  note?: string;
}

/**
 * Every value in the v2 field map carries its review state and provenance.
 * `value` is intentionally unknown: field definitions own validation and
 * writers continue to consume the stable, legacy top-level properties.
 */
export interface FieldValue<T = unknown> {
  value?: T;
  state: FieldValueState;
  confirmed: boolean;
  naReason?: string;
  rationale?: string;
  source?: FieldSourceRef;
  updatedAt?: string;
}

export type CaseFieldValue = FieldValue<unknown>;

export interface DecisionAnswer extends FieldValue<string | number | boolean | string[]> {
  fieldId: string;
}

export type SourceDocumentFormat = 'docx' | 'doc' | 'odt' | 'pdf' | 'xlsx' | 'other';
export type SourceDocumentStatus = 'uploaded' | 'parsed' | 'needs-review' | 'failed';

/** Metadata only.  The browser keeps the original bytes local and does not
 * persist them in the case record or send them to an external AI service. */
export interface SourceDocument {
  id: string;
  name: string;
  fileName: string;
  format: SourceDocumentFormat;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  importedAt: string;
  status: SourceDocumentStatus;
  localOnly: boolean;
  pageCount?: number;
  parserVersion?: string;
  error?: string;
}

/** A serialisable description of a workflow field plus an optional pure
 * applicability predicate used by the deterministic readiness evaluator. */
export interface FieldDefinition {
  id: string;
  label: string;
  section: FieldSection;
  dataType: FieldDataType;
  requirement: FieldRequirement;
  purpose: string;
  helpText: string;
  legalBasis?: string;
  options?: FieldOption[];
  legacyKey?: keyof ProcurementCase;
  targets?: Array<'requirements' | 'tender' | 'contract' | 'price-schedule'>;
  appliesWhen?: (procurementCase: ProcurementCase) => boolean;
  /** Deterministic value validation. Return a user-facing error when invalid. */
  validate?: (value: unknown, procurementCase: ProcurementCase) => string | undefined;
}

export interface PricingItem {
  id: string;
  description: string;
  quantity?: number;
  unit?: string;
  estimatedUnitPrice?: number;
  note?: string;
}

export interface ProcurementCase {
  id: string;
  title: string;
  agency: string;
  category: ProcurementCategory;
  budget: number;
  description: string;
  contractStart?: string;
  contractEnd?: string;
  paymentTerms: string;
  acceptanceMethod: string;
  deliverables: string[];
  pricingItems?: PricingItem[];
  vendorQualification: string;
  procurementMethod?: string;
  awardPrinciple?: string;
  awardMethod?: string;
  bidBond?: string;
  performanceBond?: string;
  contractPriceMethod?: string;
  internalNotes: string;
  reservePrice?: number;
  securityLevel: SecurityLevel;
  createdAt: string;
  updatedAt: string;

  /** v2 fields are optional here so existing callers and writers remain
   * source-compatible.  `normalizeProcurementCase` returns the fully-populated
   * `ProcurementCaseV2` shape for new workflow code. */
  schemaVersion?: 1 | 2;
  workflowStage?: WorkflowStage;
  intakeMode?: IntakeMode;
  fields?: Record<string, CaseFieldValue>;
  decisions?: Record<string, DecisionAnswer>;
  sourceDocuments?: SourceDocument[];
}

export interface ProcurementCaseV2 extends ProcurementCase {
  schemaVersion: 2;
  workflowStage: WorkflowStage;
  intakeMode: IntakeMode;
  fields: Record<string, CaseFieldValue>;
  sourceDocuments: SourceDocument[];
}

export interface RuleResult {
  requiredDocuments: string[];
  optionalDocuments: string[];
  confirmations: string[];
  warnings: string[];
}

export interface TemplateRecord {
  id: string;
  name: string;
  category: ProcurementCategory | 'common';
  officialDate: string;
  sourceUrl: string;
  checksum?: string;
  status: 'active' | 'candidate' | 'archived';
}
