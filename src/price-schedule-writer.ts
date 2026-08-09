import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { PricingItem, ProcurementCase } from './types';

export interface PriceScheduleReport {
  itemCount: number;
  pending: string[];
  warnings: string[];
  internalEstimateTotal: number;
  budgetDifference?: number;
}

export interface PriceScheduleWriterOptions {
  download?: boolean;
  onGenerated?: (blob: Blob, filename: string) => void;
}

function safeName(value: string) {
  return (value || '採購案件').replace(/[\\/:*?"<>|]/g, '_');
}

function normalizedItems(procurementCase: ProcurementCase): PricingItem[] {
  const configured = (procurementCase.pricingItems ?? []).filter((item) => item.description.trim());
  if (configured.length) return configured;

  return procurementCase.deliverables
    .map((description) => description.trim())
    .filter(Boolean)
    .map((description, index) => ({
      id: `deliverable-${index + 1}`,
      description,
    }));
}

function internalEstimateTotal(items: PricingItem[]) {
  return items.reduce((sum, item) => {
    if (item.quantity === undefined || item.estimatedUnitPrice === undefined) return sum;
    return sum + item.quantity * item.estimatedUnitPrice;
  }, 0);
}

function buildReport(procurementCase: ProcurementCase, items: PricingItem[]): PriceScheduleReport {
  const pending: string[] = [];
  const warnings: string[] = [];

  items.forEach((item, index) => {
    const label = `第 ${index + 1} 項「${item.description}」`;
    if (item.quantity === undefined || item.quantity <= 0) pending.push(`${label}數量`);
    if (!item.unit?.trim()) pending.push(`${label}單位`);
  });

  const estimateTotal = internalEstimateTotal(items);
  const pricedCount = items.filter(
    (item) => item.quantity !== undefined && item.quantity > 0 && item.estimatedUnitPrice !== undefined,
  ).length;

  let budgetDifference: number | undefined;
  if (procurementCase.budget > 0 && pricedCount > 0) {
    budgetDifference = procurementCase.budget - estimateTotal;
    if (Math.abs(budgetDifference) >= 1) {
      warnings.push(
        budgetDifference > 0
          ? `內部預估合計較預算少新臺幣 ${Math.round(budgetDifference).toLocaleString('zh-TW')} 元。`
          : `內部預估合計超過預算新臺幣 ${Math.round(Math.abs(budgetDifference)).toLocaleString('zh-TW')} 元。`,
      );
    }
  }

  warnings.push('內部「預估單價」只供案件編製檢核，不會寫入對外標價清單 XLSX。');

  return {
    itemCount: items.length,
    pending,
    warnings,
    internalEstimateTotal: estimateTotal,
    budgetDifference,
  };
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFB8C2D1' } };
  return { top: side, left: side, bottom: side, right: side };
}

export async function exportPriceScheduleXlsx(
  procurementCase: ProcurementCase,
  options: PriceScheduleWriterOptions = {},
): Promise<PriceScheduleReport> {
  const items = normalizedItems(procurementCase);
  if (!items.length) {
    throw new Error('尚未建立標價項目。請先新增標價項目，或由主要交付成果建立項目。');
  }

  const report = buildReport(procurementCase, items);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GovProcure Assistant';
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet('標價清單', {
    views: [{ state: 'frozen', ySplit: 6 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  sheet.columns = [
    { key: 'index', width: 8 },
    { key: 'description', width: 42 },
    { key: 'quantity', width: 12 },
    { key: 'unit', width: 12 },
    { key: 'unitPrice', width: 16 },
    { key: 'amount', width: 18 },
    { key: 'note', width: 28 },
  ];

  sheet.mergeCells('A1:G1');
  sheet.getCell('A1').value = `${procurementCase.title || '未命名採購案'}－標價清單`;
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF172033' } };
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 28;

  sheet.mergeCells('A2:B2');
  sheet.getCell('A2').value = '招標機關';
  sheet.mergeCells('C2:G2');
  sheet.getCell('C2').value = procurementCase.agency || '【待機關填列】';

  sheet.mergeCells('A3:B3');
  sheet.getCell('A3').value = '標案名稱';
  sheet.mergeCells('C3:G3');
  sheet.getCell('C3').value = procurementCase.title || '【待機關填列】';

  sheet.mergeCells('A4:G4');
  sheet.getCell('A4').value = '填寫說明：投標廠商請填列單價及複價；複價欄已內建「數量 × 單價」公式。系統內部預估單價不會寫入本檔。';
  sheet.getCell('A4').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getCell('A4').font = { italic: true, color: { argb: 'FF5D687B' } };
  sheet.getRow(4).height = 32;

  sheet.mergeCells('A5:G5');
  sheet.getCell('A5').value = '本表為機關依個案資料產生之標價清單初稿，非工程會固定格式範本；招標前仍應由承辦單位確認項目、數量、單位及計價方式。';
  sheet.getCell('A5').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getCell('A5').font = { size: 10, color: { argb: 'FF7A4D00' } };
  sheet.getRow(5).height = 32;

  const headerRow = sheet.getRow(6);
  headerRow.values = ['項次', '工作項目／交付成果', '數量', '單位', '單價（元）', '複價（元）', '備註'];
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244078' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  headerRow.height = 26;
  headerRow.eachCell((cell) => { cell.border = thinBorder(); });

  items.forEach((item, index) => {
    const row = sheet.addRow([
      index + 1,
      item.description,
      item.quantity ?? null,
      item.unit?.trim() ?? '',
      null,
      null,
      item.note?.trim() ?? '',
    ]);

    const rowNumber = row.number;
    row.getCell(6).value = {
      formula: `IF(OR(C${rowNumber}="",E${rowNumber}=""),"",C${rowNumber}*E${rowNumber})`,
      result: '',
    };
    row.getCell(3).numFmt = '0.####';
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).numFmt = '#,##0';
    row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4DA' } };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.height = 24;
    row.eachCell({ includeEmpty: true }, (cell) => { cell.border = thinBorder(); });
  });

  const firstItemRow = 7;
  const lastItemRow = firstItemRow + items.length - 1;
  const totalRow = sheet.addRow(['', '', '', '', '總價', null, '']);
  totalRow.getCell(6).value = {
    formula: `IF(COUNT(E${firstItemRow}:E${lastItemRow})=0,"",SUM(F${firstItemRow}:F${lastItemRow}))`,
    result: '',
  };
  totalRow.getCell(5).font = { bold: true };
  totalRow.getCell(6).font = { bold: true };
  totalRow.getCell(6).numFmt = '#,##0';
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = thinBorder();
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6F9' } };
  });

  const signatureRow = totalRow.number + 2;
  sheet.mergeCells(`A${signatureRow}:C${signatureRow}`);
  sheet.mergeCells(`E${signatureRow}:G${signatureRow}`);
  sheet.getCell(`A${signatureRow}`).value = '投標廠商：____________________________';
  sheet.getCell(`E${signatureRow}`).value = '負責人：____________________________';

  sheet.getColumn(1).alignment = { horizontal: 'center' };
  sheet.getColumn(3).alignment = { horizontal: 'right' };
  sheet.getColumn(4).alignment = { horizontal: 'center' };
  sheet.getColumn(5).alignment = { horizontal: 'right' };
  sheet.getColumn(6).alignment = { horizontal: 'right' };
  sheet.autoFilter = { from: 'A6', to: `G${lastItemRow}` };

  sheet.headerFooter.oddFooter = '&LGovProcure Assistant 產製初稿&C第 &P 頁，共 &N 頁&R請依正式招標文件確認';

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const filename = `${safeName(procurementCase.title)}_標價清單_初稿.xlsx`;
  options.onGenerated?.(blob, filename);
  if (options.download !== false) saveAs(blob, filename);

  return report;
}
