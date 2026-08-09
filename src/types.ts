export type ProcurementCategory = 'service' | 'goods' | 'construction' | 'unknown';
export type SecurityLevel = 'PUBLIC' | 'INTERNAL' | 'SENSITIVE' | 'RESTRICTED';

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
  vendorQualification: string;
  internalNotes: string;
  reservePrice?: number;
  securityLevel: SecurityLevel;
  createdAt: string;
  updatedAt: string;
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
