import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import { buildAllTemplateMappingPreviews, formatBondSetting } from './mapping';
import type { ProcurementCase, RuleResult } from './types';

export async function exportCaseDocx(procurementCase: ProcurementCase, rules: RuleResult) {
  const rows = [
    ['機關', procurementCase.agency || '未填'],
    ['案名', procurementCase.title || '未填'],
    ['採購類型', procurementCase.category],
    ['預算', procurementCase.budget ? `NT$ ${procurementCase.budget.toLocaleString()}` : '未填'],
    ['履約期間', `${procurementCase.contractStart || '未填'} ～ ${procurementCase.contractEnd || '未填'}`],
    ['招標方式', procurementCase.procurementMethod || '未填'],
    ['決標原則', procurementCase.awardPrinciple || '未填'],
    ['決標方式', procurementCase.awardMethod || '未填'],
    ['契約價金計算方式', procurementCase.contractPriceMethod || '未填'],
    ['押標金', formatBondSetting(procurementCase, 'bidBond') || '未填'],
    ['履約保證金', formatBondSetting(procurementCase, 'performanceBond') || '未填'],
    ['付款條件', procurementCase.paymentTerms || '未填'],
    ['驗收方式', procurementCase.acceptanceMethod || '未填'],
    ['廠商資格', procurementCase.vendorQualification || '未填'],
  ];
  const mappingPreviews = buildAllTemplateMappingPreviews(procurementCase);

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: '公務採購案件設定及文件檢核表', heading: HeadingLevel.TITLE }),
          new Paragraph({ text: '本文件由 GovProcure Assistant 於本機產生；不代表採購合法性已完成審查。' }),
          ...rows.map(([label, value]) =>
            new Paragraph({ children: [new TextRun({ text: `${label}：`, bold: true }), new TextRun(value)] }),
          ),
          new Paragraph({ text: '採購需求', heading: HeadingLevel.HEADING_1 }),
          new Paragraph(procurementCase.description || '未填'),
          new Paragraph({ text: '必要文件', heading: HeadingLevel.HEADING_1 }),
          ...rules.requiredDocuments.map((item) => new Paragraph({ text: item, bullet: { level: 0 } })),
          new Paragraph({ text: '需人工確認', heading: HeadingLevel.HEADING_1 }),
          ...(rules.confirmations.length
            ? rules.confirmations.map((item) => new Paragraph({ text: item, bullet: { level: 0 } }))
            : [new Paragraph('目前無未完成確認項目。')]),
          new Paragraph({ text: '系統警示', heading: HeadingLevel.HEADING_1 }),
          ...(rules.warnings.length
            ? rules.warnings.map((item) => new Paragraph({ text: item, bullet: { level: 0 } }))
            : [new Paragraph('目前無警示。')]),
          new Paragraph({ text: '官方範本欄位 Mapping', heading: HeadingLevel.HEADING_1 }),
          ...mappingPreviews.flatMap((preview) => [
            new Paragraph({
              children: [
                new TextRun({ text: `${preview.templateName}：`, bold: true }),
                new TextRun(`必要欄位 ${preview.readyRequiredCount}/${preview.requiredCount}，覆蓋率 ${preview.coverage}%`),
              ],
            }),
            ...preview.rows.map((row) =>
              new Paragraph({
                text: `${row.ready ? '已填' : row.required ? '待補' : '選填'}｜${row.canonicalLabel} → ${row.targetLabel}｜${row.value || '未填'}｜Anchor: ${row.anchor}`,
                bullet: { level: 0 },
              }),
            ),
          ]),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const safeName = (procurementCase.title || '採購案件').replace(/[\\/:*?"<>|]/g, '_');
  saveAs(blob, `${safeName}_案件設定及檢核.docx`);
}

export function exportCaseJson(procurementCase: ProcurementCase) {
  const blob = new Blob([JSON.stringify(procurementCase, null, 2)], { type: 'application/json;charset=utf-8' });
  const safeName = (procurementCase.title || '採購案件').replace(/[\\/:*?"<>|]/g, '_');
  saveAs(blob, `${safeName}.json`);
}
