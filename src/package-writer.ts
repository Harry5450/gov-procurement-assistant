import { saveAs } from 'file-saver';
import { strToU8, zipSync } from 'fflate';
import { buildCrossDocumentConsistencyReport } from './consistency';
import { exportPriceScheduleXlsx } from './price-schedule-writer';
import { exportServiceRequirementsDraft } from './requirements-writer';
import { exportServiceContractDraft } from './service-contract-writer';
import { exportTenderInstructionsDraft } from './template-writer';
import type { ProcurementCase } from './types';

interface GeneratedFile {
  blob: Blob;
  filename: string;
}

export interface PackageWriteReport {
  filename: string;
  fileCount: number;
  warnings: string[];
}

function safeName(value: string) {
  return (value || '採購案件').replace(/[\\/:*?"<>|]/g, '_');
}

async function toBytes(file: GeneratedFile) {
  return new Uint8Array(await file.blob.arrayBuffer());
}

function publicSafePreflightText(procurementCase: ProcurementCase) {
  const report = buildCrossDocumentConsistencyReport(procurementCase);
  const lines = [
    'GovProcure Assistant｜完整招標文件包一致性檢核報告',
    '',
    `標案名稱：${procurementCase.title}`,
    `招標機關：${procurementCase.agency}`,
    `檢核結果：${report.canPackage ? '通過' : '未通過'}`,
    `通過項目：${report.passes.length}`,
    `提醒項目：${report.warnings.length}`,
    `阻擋項目：${report.blockers.length}`,
    '',
    '文件就緒狀態：',
    ...report.documentReadiness.map((item) =>
      `- ${item.ready ? 'OK' : 'NOT READY'} ${item.name}：${item.readyCount}/${item.requiredCount}${item.missing.length ? `；缺少 ${item.missing.join('、')}` : ''}`,
    ),
    '',
    '跨文件提醒：',
  ];

  const publicWarnings = report.warnings.filter(
    (item) => item.id !== 'pricing-budget' && item.id !== 'reserve-price-budget',
  );
  if (publicWarnings.length) {
    lines.push(...publicWarnings.map((item) => `- ${item.label}：${item.message}`));
  } else {
    lines.push('- 無需寫入文件包的跨文件提醒。');
  }

  lines.push(
    '',
    '隱私說明：',
    '- 本報告不包含底價／預估底價、內部備註或標價項目的內部預估單價。',
    '- 內部價格相關檢查已在本機完成，不寫入本文件包。',
    '- 本文件包仍屬初稿；正式公告或招標前應依機關內控程序完成採購、法制、主計及相關專業審查。',
  );

  return lines.join('\r\n');
}

function packageReadme(procurementCase: ProcurementCase, warningCount: number) {
  return [
    'GovProcure Assistant｜完整招標文件包',
    '',
    `標案名稱：${procurementCase.title}`,
    `招標機關：${procurementCase.agency}`,
    '採購類型：勞務採購',
    `預算金額：新臺幣 ${Math.round(procurementCase.budget).toLocaleString('zh-TW')} 元`,
    '',
    '本 ZIP 由同一份 ProcurementCase 於瀏覽器本機 deterministic 產生。',
    '包含投標須知、勞務採購契約、需求規格書、標價清單及一致性檢核報告。',
    `Preflight 已通過；目前另有 ${warningCount} 項非阻擋提醒，請參閱一致性檢核報告。`,
    '',
    '重要：本文件包為招標文件初稿，不代表已完成法定或機關內部審查。',
    'ZIP 不包含底價／預估底價、內部備註或標價項目的內部預估單價。',
  ].join('\r\n');
}

export async function exportCompleteServiceProcurementPackage(
  procurementCase: ProcurementCase,
): Promise<PackageWriteReport> {
  const preflight = buildCrossDocumentConsistencyReport(procurementCase);
  if (!preflight.canPackage) {
    const blockerSummary = preflight.blockers.map((item) => `${item.label}：${item.message}`).join('；');
    throw new Error(`完整招標文件包尚不可輸出。${blockerSummary || '請先完成 Preflight 必要欄位。'}`);
  }

  let tenderFile: GeneratedFile | undefined;
  let serviceFile: GeneratedFile | undefined;
  let requirementsFile: GeneratedFile | undefined;
  let priceFile: GeneratedFile | undefined;

  const tenderReport = await exportTenderInstructionsDraft(procurementCase, {
    download: false,
    onGenerated: (blob, filename) => { tenderFile = { blob, filename }; },
  });
  const serviceReport = await exportServiceContractDraft(procurementCase, {
    download: false,
    onGenerated: (blob, filename) => { serviceFile = { blob, filename }; },
  });
  const requirementsReport = await exportServiceRequirementsDraft(procurementCase, {
    download: false,
    onGenerated: (blob, filename) => { requirementsFile = { blob, filename }; },
  });
  const priceReport = await exportPriceScheduleXlsx(procurementCase, {
    download: false,
    onGenerated: (blob, filename) => { priceFile = { blob, filename }; },
  });

  if (!tenderFile || !serviceFile || !requirementsFile || !priceFile) {
    throw new Error('文件產生器未回傳完整檔案，已停止 ZIP 打包。');
  }

  const unresolved = [
    ...tenderReport.pending.map((item) => `投標須知：${item}`),
    ...serviceReport.pending.map((item) => `勞務契約：${item}`),
    ...requirementsReport.pending.map((item) => `需求規格書：${item}`),
    ...priceReport.pending.map((item) => `標價清單：${item}`),
  ];
  if (unresolved.length) {
    throw new Error(`文件 Writer 仍有待人工補充欄位，已停止整包輸出：${unresolved.join('；')}`);
  }

  const structuralWarnings = [
    ...tenderReport.warnings,
    ...serviceReport.warnings,
  ].filter((warning) => warning.includes('未在官方'));
  if (structuralWarnings.length) {
    throw new Error(`官方範本 Anchor 寫入未完全成功，已停止整包輸出：${structuralWarnings.join('；')}`);
  }

  const entries: Parameters<typeof zipSync>[0] = {
    '00_文件包說明.txt': strToU8(packageReadme(procurementCase, preflight.warnings.length)),
    [`01_${tenderFile.filename}`]: await toBytes(tenderFile),
    [`02_${serviceFile.filename}`]: await toBytes(serviceFile),
    [`03_${requirementsFile.filename}`]: await toBytes(requirementsFile),
    [`04_${priceFile.filename}`]: await toBytes(priceFile),
    '99_一致性檢核報告.txt': strToU8(publicSafePreflightText(procurementCase)),
  };

  const zipBytes = zipSync(entries, { level: 6 });
  const filename = `${safeName(procurementCase.title)}_完整招標文件包_初稿.zip`;
  saveAs(new Blob([zipBytes], { type: 'application/zip' }), filename);

  return {
    filename,
    fileCount: Object.keys(entries).length,
    warnings: preflight.warnings.map((item) => `${item.label}：${item.message}`),
  };
}
