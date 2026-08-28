import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canExportCase,
  evaluateCaseReadiness,
  normalizeProcurementCase,
  updateCaseField,
} from '../src/case-workflow.ts';
import {
  SERVICE_DECISION_VALUES,
  legacyToStableValue,
  ordinaryServiceFieldRegistry,
  stableToLegacyValue,
} from '../src/field-registry.ts';
import { PROCUREMENT_VALUES } from '../src/procurement-guidance.ts';
import { buildCanonicalDocumentContext } from '../src/mapping.ts';
import type { ProcurementCase } from '../src/types.ts';

function legacyCase(overrides: Partial<ProcurementCase> = {}): ProcurementCase {
  return {
    id: 'case-test',
    title: '校園防災演練服務',
    agency: '測試機關',
    category: 'service',
    budget: 500_000,
    description: '規劃及執行年度防災演練。',
    contractStart: '2026-09-01',
    contractEnd: '2026-12-31',
    paymentTerms: '成果驗收後付款。',
    acceptanceMethod: '依成果清單逐項驗收。',
    deliverables: ['演練計畫', '成果報告'],
    pricingItems: [{ id: 'item-1', description: '演練規劃與執行', quantity: 1, unit: '式' }],
    vendorQualification: '具相關服務經驗。',
    procurementMethod: PROCUREMENT_VALUES.openTender,
    awardPrinciple: PROCUREMENT_VALUES.lowestWithReserve,
    awardMethod: PROCUREMENT_VALUES.totalAward,
    bidBond: 'none',
    performanceBond: 'none',
    contractPriceMethod: PROCUREMENT_VALUES.totalPackage,
    internalNotes: '僅供機關內部。',
    securityLevel: 'INTERNAL',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

test('normalization preserves legacy writer fields and adds v2 provenance', () => {
  const normalized = normalizeProcurementCase({
    ...legacyCase(),
    sourceDocuments: [{
      id: 'source-1',
      name: '需求書.docx',
      fileName: '需求書.docx',
      format: 'docx',
      importedAt: '2026-08-01T00:00:00.000Z',
      status: 'parsed',
      localOnly: false,
    }],
  });

  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.workflowStage, 'procurement-decisions');
  assert.equal(normalized.intakeMode, 'legacy');
  assert.equal(normalized.title, '校園防災演練服務');
  assert.equal(normalized.fields['requirements.title'].value, normalized.title);
  assert.equal(normalized.fields['requirements.title'].state, 'provided');
  assert.equal(normalized.fields['requirements.title'].confirmed, true);
  assert.equal(normalized.fields['requirements.title'].source?.kind, 'legacy');
  assert.equal(
    normalized.fields['decisions.procurementMethod'].value,
    SERVICE_DECISION_VALUES.openTender,
  );
  assert.equal(normalized.sourceDocuments.length, 1);
  assert.equal(normalized.sourceDocuments[0].localOnly, true);
});

test('readiness reports missing values and does not treat AI or upload suggestions as confirmed', () => {
  const normalized = normalizeProcurementCase({
    ...legacyCase(),
    awardPrinciple: undefined,
    fields: {
      'requirements.title': {
        value: 'AI 建議名稱',
        state: 'provided',
        confirmed: false,
        source: { kind: 'ai' },
      },
    },
  });
  const report = evaluateCaseReadiness(normalized);

  assert.equal(report.ready, false);
  assert.equal(report.blockingIssues.some((item) => item.fieldId === 'requirements.title'), true);
  assert.equal(report.blockingIssues.some((item) => item.fieldId === 'decisions.awardPrinciple'), true);
  assert.equal(report.fields.some((item) => item.status === 'not-applicable' && item.fieldId === 'contract.insuranceTypes'), true);
});

test('field updates mirror known legacy properties and make the formal gate deterministic', () => {
  let current = normalizeProcurementCase(legacyCase({
    procurementMethod: undefined,
    awardPrinciple: undefined,
    awardMethod: undefined,
    contractPriceMethod: undefined,
    bidBond: undefined,
    performanceBond: undefined,
  }));
  const updates: Array<[string, unknown]> = [
    ['decisions.procurementMethod', SERVICE_DECISION_VALUES.publicQuote],
    ['decisions.awardPrinciple', SERVICE_DECISION_VALUES.referenceMostAdvantageous],
    ['decisions.awardMethod', SERVICE_DECISION_VALUES.totalAward],
    ['decisions.evaluationDetails', '依評審項目、配分及同分規則辦理。'],
    ['decisions.contractPriceMethod', SERVICE_DECISION_VALUES.lumpSum],
    ['decisions.bidBond', SERVICE_DECISION_VALUES.bidBondNone],
    ['decisions.performanceBond', SERVICE_DECISION_VALUES.performanceBondNone],
    ['contract.insuranceRequired', SERVICE_DECISION_VALUES.insuranceNone],
    ['contract.insuranceWaiverReason', '本案風險低並採替代控管措施，故不要求投保。'],
    ['contract.ipRights', '機關取得成果使用權。'],
  ];
  for (const [fieldId, value] of updates) {
    current = updateCaseField(current, fieldId, { value, confirmed: true, sourceKind: 'user' });
  }

  assert.equal(current.fields['decisions.procurementMethod'].value, SERVICE_DECISION_VALUES.publicQuote);
  assert.equal(current.procurementMethod, PROCUREMENT_VALUES.publicQuote);
  assert.equal(current.fields['decisions.contractPriceMethod'].value, SERVICE_DECISION_VALUES.lumpSum);
  assert.equal(current.contractPriceMethod, PROCUREMENT_VALUES.totalPackage);
  assert.equal(current.decisions?.['decisions.awardMethod'].fieldId, 'decisions.awardMethod');
  assert.equal(canExportCase(current), true);
});

test('stable decision values are unique and round-trip to legacy guidance values', () => {
  const decisionOptions = ordinaryServiceFieldRegistry
    .filter((definition) => definition.section === 'decisions')
    .flatMap((definition) => definition.options ?? []);
  const stableValues = decisionOptions.map((option) => option.value);
  assert.equal(new Set(stableValues).size, stableValues.length);
  assert.notEqual(SERVICE_DECISION_VALUES.lowestWithReserve, SERVICE_DECISION_VALUES.lowestWithoutReserve);

  assert.equal(
    stableToLegacyValue('decisions.awardPrinciple', SERVICE_DECISION_VALUES.lowestWithReserve),
    PROCUREMENT_VALUES.lowestWithReserve,
  );
  assert.equal(
    legacyToStableValue('decisions.awardPrinciple', PROCUREMENT_VALUES.lowestWithoutReserve),
    SERVICE_DECISION_VALUES.lowestWithoutReserve,
  );
  assert.equal(
    stableToLegacyValue('decisions.contractPriceMethod', SERVICE_DECISION_VALUES.lumpSum),
    PROCUREMENT_VALUES.totalPackage,
  );
});

test('v2 cases with a blank stage start at intake while old cases start at decisions', () => {
  const legacy = normalizeProcurementCase(legacyCase());
  const blankV2 = normalizeProcurementCase({
    ...legacyCase(),
    schemaVersion: 2,
    workflowStage: undefined,
    intakeMode: undefined,
  });
  assert.equal(legacy.workflowStage, 'procurement-decisions');
  assert.equal(legacy.intakeMode, 'legacy');
  assert.equal(blankV2.workflowStage, 'intake');
  assert.equal(blankV2.intakeMode, 'guided');
});

test('a blank new v2 case cannot pass the requirements readiness gate', () => {
  const blank = normalizeProcurementCase({ schemaVersion: 2, intakeMode: 'guided' });
  const report = evaluateCaseReadiness(blank);

  assert.equal(blank.workflowStage, 'intake');
  assert.equal(report.ready, false);
  assert.equal(report.score, 0);
  assert.equal(report.blockingIssues.some((item) => item.fieldId === 'requirements.category'), true);
  assert.equal(report.blockingIssues.some((item) => item.fieldId === 'requirements.budget'), true);
  assert.equal(report.blockingIssues.some((item) => item.fieldId === 'pricing.items'), true);
});

test('v2 field values remain canonical while legacy writer properties are mirrored', () => {
  const v2 = normalizeProcurementCase({
    schemaVersion: 2,
    category: 'service',
    fields: {
      'requirements.category': { value: 'service', state: 'provided', confirmed: true },
      'requirements.budget': { value: 250_000, state: 'provided', confirmed: true },
      'requirements.contractStart': { value: '2026-09-01', state: 'provided', confirmed: true },
      'requirements.contractEnd': { value: '2026-12-31', state: 'provided', confirmed: true },
      'pricing.items': {
        value: [{ id: 'item-1', description: '服務', quantity: 1, unit: '式' }],
        state: 'provided',
        confirmed: true,
      },
      'decisions.procurementMethod': {
        value: SERVICE_DECISION_VALUES.publicQuote,
        state: 'provided',
        confirmed: true,
      },
    },
  });

  assert.equal(v2.procurementMethod, PROCUREMENT_VALUES.publicQuote);
  assert.equal(v2.fields['decisions.procurementMethod'].value, SERVICE_DECISION_VALUES.publicQuote);
  assert.equal(v2.budget, 250_000);
  assert.equal(v2.pricingItems?.[0].unit, '式');
});

test('conditional evaluation and guarantee details become blocking only when selected', () => {
  const baseline = evaluateCaseReadiness(normalizeProcurementCase(legacyCase()));
  assert.equal(baseline.fields.find((item) => item.fieldId === 'decisions.evaluationDetails')?.status, 'not-applicable');
  assert.equal(baseline.fields.find((item) => item.fieldId === 'decisions.bidBondDetails')?.status, 'not-applicable');
  assert.equal(baseline.fields.find((item) => item.fieldId === 'decisions.performanceBondDetails')?.status, 'not-applicable');

  let active = normalizeProcurementCase(legacyCase({
    awardPrinciple: PROCUREMENT_VALUES.referenceMostAdvantageous,
    bidBond: 'required',
    performanceBond: 'required',
  }));
  let report = evaluateCaseReadiness(active);
  for (const fieldId of [
    'decisions.evaluationDetails',
    'decisions.bidBondDetails',
    'decisions.performanceBondDetails',
  ]) {
    assert.equal(report.blockingIssues.some((item) => item.fieldId === fieldId), true);
  }

  active = updateCaseField(active, 'decisions.evaluationDetails', {
    value: '評審項目、配分、門檻及同分處理方式。',
    confirmed: true,
  });
  active = updateCaseField(active, 'decisions.bidBondDetails', {
    value: '押標金新臺幣一萬元，銀行保證，有效期至投標期限後。',
    confirmed: true,
  });
  active = updateCaseField(active, 'decisions.performanceBondDetails', {
    value: '履約保證金為契約價金百分之十，驗收合格後返還。',
    confirmed: true,
  });
  report = evaluateCaseReadiness(active);
  for (const fieldId of [
    'decisions.evaluationDetails',
    'decisions.bidBondDetails',
    'decisions.performanceBondDetails',
  ]) {
    assert.equal(report.blockingIssues.some((item) => item.fieldId === fieldId), false);
  }
});

test('choosing no insurance requires a documented waiver reason', () => {
  let current = normalizeProcurementCase(legacyCase());
  current = updateCaseField(current, 'contract.insuranceRequired', {
    value: SERVICE_DECISION_VALUES.insuranceNone,
    confirmed: true,
  });
  let report = evaluateCaseReadiness(current);
  assert.equal(report.blockingIssues.some((item) => item.fieldId === 'contract.insuranceWaiverReason'), true);

  current = updateCaseField(current, 'contract.insuranceWaiverReason', {
    value: '已完成風險評估並採替代控管措施。',
    confirmed: true,
  });
  report = evaluateCaseReadiness(current);
  assert.equal(report.blockingIssues.some((item) => item.fieldId === 'contract.insuranceWaiverReason'), false);
});

test('not-applicable and waived values require an explicit reason', () => {
  let current = normalizeProcurementCase(legacyCase());
  current = updateCaseField(current, 'contract.insuranceTypes', {
    state: 'not-applicable',
    confirmed: false,
  });
  let report = evaluateCaseReadiness(current);
  // It is conditionally not applicable while insurance is not selected, so it
  // cannot block the case.  If explicitly waived for an applicable field, a
  // reason and confirmation are required.
  assert.equal(report.fields.find((item) => item.fieldId === 'contract.insuranceTypes')?.status, 'not-applicable');

  current = updateCaseField(current, 'contract.insuranceTypes', {
    confirmed: true,
    naReason: '保險未觸發，維持不適用。',
  });
  assert.equal(current.fields['contract.insuranceTypes'].state, 'not-applicable');

  current = updateCaseField(current, 'contract.insuranceRequired', {
    value: 'required',
    confirmed: true,
    sourceKind: 'user',
  });
  current = updateCaseField(current, 'contract.insuranceTypes', {
    state: 'waived',
    confirmed: false,
  });
  report = evaluateCaseReadiness(current);
  assert.equal(report.blockingIssues.some((item) => item.fieldId === 'contract.insuranceTypes'), true);

  current = updateCaseField(current, 'contract.ipRights', {
    value: '機關取得成果使用權。',
    confirmed: true,
    sourceKind: 'user',
  });

  current = updateCaseField(current, 'contract.insuranceTypes', {
    state: 'waived',
    confirmed: true,
    naReason: '本案改由機關既有保險承保。',
    sourceKind: 'user',
  });
  report = evaluateCaseReadiness(current);
  assert.equal(report.blockingIssues.some((item) => item.fieldId === 'contract.insuranceTypes'), false);
});

test('bond machine values are never emitted verbatim in document context', () => {
  let current = normalizeProcurementCase(legacyCase({ bidBond: 'none', performanceBond: 'required' }));
  current = updateCaseField(current, 'decisions.performanceBondDetails', {
    value: '契約金額百分之十；驗收合格後返還。',
    confirmed: true,
    sourceKind: 'user',
  });
  const context = buildCanonicalDocumentContext(current);
  assert.equal(context.bidBond.value, '不收取');
  assert.equal(context.performanceBond.value, '收取；契約金額百分之十；驗收合格後返還。');
});
