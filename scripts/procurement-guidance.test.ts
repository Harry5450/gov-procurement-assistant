import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProcurementGuidance,
  getProcurementAmountBand,
  isGuidanceOptionValue,
  PROCUREMENT_VALUES,
} from '../src/procurement-guidance.ts';

function guidance(
  budget: number,
  category: 'unknown' | 'service' | 'goods' | 'construction' = 'service',
  procurementMethod?: string,
) {
  return buildProcurementGuidance({ budget, category, procurementMethod });
}

test('amount bands keep the 15萬 and 150萬 boundaries exact', () => {
  assert.equal(getProcurementAmountBand(0), 'unset');
  assert.equal(getProcurementAmountBand(Number.NaN), 'unset');
  assert.equal(getProcurementAmountBand(150_000), 'small');
  assert.equal(getProcurementAmountBand(150_001), 'below-announcement');
  assert.equal(getProcurementAmountBand(1_499_999), 'below-announcement');
  assert.equal(getProcurementAmountBand(1_500_000), 'announcement-or-above');
});

test('a central-agency NT$500,000 service uses public quote/proposal as the default path', () => {
  const result = guidance(500_000, 'service');
  const methods = result.methodOptions.map((option) => option.value);

  assert.equal(result.band, 'below-announcement');
  assert.equal(result.recommended.procurementMethod, PROCUREMENT_VALUES.publicQuote);
  assert.equal(result.recommended.awardPrinciple, PROCUREMENT_VALUES.referenceMostAdvantageous);
  assert.equal(methods.includes(PROCUREMENT_VALUES.publicQuote), true);
  assert.equal(methods.includes(PROCUREMENT_VALUES.restrictedTender), true);
  assert.equal(methods.includes(PROCUREMENT_VALUES.directSmall), false);
  assert.equal(methods.includes(PROCUREMENT_VALUES.openTender), false);
});

test('a NT$500,000 goods case recommends lowest tender while keeping human alternatives', () => {
  const result = guidance(500_000, 'goods');
  assert.equal(result.recommended.awardPrinciple, PROCUREMENT_VALUES.lowestWithReserve);
  assert.equal(result.awardPrincipleOptions.some((option) => option.value === PROCUREMENT_VALUES.referenceMostAdvantageous), true);
});

test('announcement amount starts at NT$1,500,000 and excludes the below-threshold public quote path', () => {
  const result = guidance(1_500_000, 'service');
  const methods = result.methodOptions.map((option) => option.value);

  assert.equal(result.recommended.procurementMethod, PROCUREMENT_VALUES.openTender);
  assert.deepEqual(methods, [
    PROCUREMENT_VALUES.openTender,
    PROCUREMENT_VALUES.selectiveTender,
    PROCUREMENT_VALUES.restrictedTender,
  ]);
  assert.equal(methods.includes(PROCUREMENT_VALUES.publicQuote), false);
});

test('award principles depend on the selected procurement method', () => {
  const below = guidance(500_000, 'service', PROCUREMENT_VALUES.publicQuote);
  assert.equal(isGuidanceOptionValue(PROCUREMENT_VALUES.referenceMostAdvantageous, below.awardPrincipleOptions), true);
  assert.equal(isGuidanceOptionValue(PROCUREMENT_VALUES.mostAdvantageous, below.awardPrincipleOptions), false);

  const open = guidance(2_000_000, 'service', PROCUREMENT_VALUES.openTender);
  assert.equal(isGuidanceOptionValue(PROCUREMENT_VALUES.mostAdvantageous, open.awardPrincipleOptions), true);
  assert.equal(isGuidanceOptionValue(PROCUREMENT_VALUES.referenceMostAdvantageous, open.awardPrincipleOptions), false);
});

test('restricted and incompatible legacy methods always surface legal warnings', () => {
  const restricted = guidance(500_000, 'service', PROCUREMENT_VALUES.restrictedTender);
  assert.equal(restricted.warnings.some((warning) => warning.includes('具體法定事由')), true);

  const legacy = guidance(500_000, 'service', '公開招標');
  assert.equal(legacy.warnings.some((warning) => warning.includes('不在此金額級距')), true);
});

test('all official tender-template award forms and category-specific price methods are selectable', () => {
  const service = guidance(500_000, 'service');
  assert.deepEqual(service.awardMethodOptions.map((option) => option.value), [
    PROCUREMENT_VALUES.totalAward,
    PROCUREMENT_VALUES.itemAward,
    PROCUREMENT_VALUES.groupAward,
    PROCUREMENT_VALUES.quantityAward,
    PROCUREMENT_VALUES.unitAward,
    PROCUREMENT_VALUES.otherAward,
  ]);
  assert.equal(service.contractPriceMethodOptions.some((option) => option.value === PROCUREMENT_VALUES.monthly), true);

  const goods = guidance(500_000, 'goods');
  assert.deepEqual(goods.contractPriceMethodOptions.map((option) => option.value), [
    PROCUREMENT_VALUES.totalPackage,
    PROCUREMENT_VALUES.unitPrice,
  ]);
});
