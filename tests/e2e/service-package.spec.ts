import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

function archiveText(bytes: Uint8Array) {
  const archive = unzipSync(bytes);
  return Object.entries(archive)
    .filter(([name]) => name === 'mimetype' || /\.(xml|rels|txt)$/i.test(name))
    .map(([name, data]) => `${name}\n${strFromU8(data)}`)
    .join('\n');
}

function assertZipBasedOfficeFile(bytes: Uint8Array) {
  expect(bytes[0]).toBe(0x50);
  expect(bytes[1]).toBe(0x4b);
}

test('完整勞務採購 Happy Path 可產生可開啟且不洩漏內部資料的 ZIP', async ({ page }) => {
  const agency = 'E2E測試縣政府';
  const originalTitle = '115年度E2E資訊系統維護案';
  const finalTitle = '115年度E2E資訊系統維護案－修正版';
  const description = 'E2E測試服務範圍：辦理資訊系統全年維護、障礙排除與定期檢查。';
  const paymentTerms = '每季驗收合格後付款';
  const acceptanceMethod = '成果報告、維護紀錄及功能測試均符合需求後辦理驗收';
  const internalNote = 'E2E_SECRET_INTERNAL_NOTE_DO_NOT_EXPORT';
  const reservePrice = '777777';
  const internalUnitPrice = '490000';

  await page.goto('/');

  await page.getByLabel('採購類型').selectOption('service');
  const packageButton = page.getByRole('button', { name: '一鍵下載完整招標文件包 ZIP' });
  await expect(packageButton).toBeDisabled();

  await page.getByLabel('機關名稱').fill(agency);
  await page.getByLabel('案名').fill(originalTitle);
  await page.getByLabel('預算金額').fill('980000');
  await page.getByLabel('履約開始').fill('2026-01-01');
  await page.getByLabel('履約結束').fill('2026-12-31');
  await page.getByLabel('採購需求').fill(description);

  await page.getByLabel('招標方式').fill('公開招標');
  await page.getByLabel('決標原則').fill('最低標');
  await page.getByLabel('決標方式').fill('總價決標');
  await page.getByLabel('契約價金計算方式').fill('總包價法');
  await page.getByLabel('押標金').fill('免收');
  await page.getByLabel('履約保證金').fill('免收');

  await page.getByLabel('付款條件').fill(paymentTerms);
  await page.getByLabel('驗收方式').fill(acceptanceMethod);
  await page.getByLabel('廠商資格').fill('依法登記或設立且得提供資訊服務之廠商');
  await page.getByLabel('主要交付成果').fill('每月維護報告\n系統備份紀錄');

  await page.getByRole('button', { name: '從交付成果建立' }).click();
  await expect(page.getByLabel('第 2 項數量')).toBeVisible();
  await page.getByLabel('第 1 項數量').fill('1');
  await page.getByLabel('第 1 項單位').fill('式');
  await page.getByLabel('第 1 項內部預估單價').fill(internalUnitPrice);
  await page.getByLabel('第 2 項數量').fill('1');
  await page.getByLabel('第 2 項單位').fill('式');
  await page.getByLabel('第 2 項內部預估單價').fill(internalUnitPrice);

  await page.getByLabel('底價／預估底價（高度敏感）').fill(reservePrice);
  await page.getByLabel('內部備註').fill(internalNote);

  await expect(packageButton).toBeEnabled();
  await expect(page.getByText(/整包輸出就緒/)).toBeVisible();

  // Reactive gate: removing one required shared value must immediately block packaging.
  await page.getByLabel('付款條件').fill('');
  await expect(packageButton).toBeDisabled();
  await page.getByLabel('付款條件').fill(paymentTerms);
  await expect(packageButton).toBeEnabled();

  // Last-minute edit: generated documents must use the current single-source value.
  await page.getByLabel('案名').fill(finalTitle);
  await expect(packageButton).toBeEnabled();

  const downloadPromise = page.waitForEvent('download');
  await packageButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('完整招標文件包_初稿.zip');

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const outerBytes = new Uint8Array(await readFile(downloadPath!));
  const outer = unzipSync(outerBytes);
  const names = Object.keys(outer).sort();

  expect(names).toHaveLength(6);
  expect(names).toContain('00_文件包說明.txt');
  expect(names).toContain('99_一致性檢核報告.txt');

  const tenderName = names.find((name) => name.startsWith('01_') && name.endsWith('.docx'));
  const serviceName = names.find((name) => name.startsWith('02_') && name.endsWith('.odt'));
  const requirementsName = names.find((name) => name.startsWith('03_') && name.endsWith('.docx'));
  const priceName = names.find((name) => name.startsWith('04_') && name.endsWith('.xlsx'));
  expect(tenderName).toBeTruthy();
  expect(serviceName).toBeTruthy();
  expect(requirementsName).toBeTruthy();
  expect(priceName).toBeTruthy();

  const tenderBytes = outer[tenderName!];
  const serviceBytes = outer[serviceName!];
  const requirementsBytes = outer[requirementsName!];
  const priceBytes = outer[priceName!];
  [tenderBytes, serviceBytes, requirementsBytes, priceBytes].forEach(assertZipBasedOfficeFile);

  const tenderText = archiveText(tenderBytes);
  const serviceText = archiveText(serviceBytes);
  const requirementsText = archiveText(requirementsBytes);
  const priceText = archiveText(priceBytes);
  const readmeText = strFromU8(outer['00_文件包說明.txt']);
  const reportText = strFromU8(outer['99_一致性檢核報告.txt']);
  const allPublicText = [tenderText, serviceText, requirementsText, priceText, readmeText, reportText].join('\n');

  expect(tenderText).toContain(finalTitle);
  expect(serviceText).toContain(agency);
  expect(serviceText).toContain('E2E測試服務範圍');
  expect(requirementsText).toContain(finalTitle);
  expect(requirementsText).toContain(paymentTerms);
  expect(priceText).toContain(finalTitle);
  expect(priceText).toContain('每月維護報告');

  const serviceArchive = unzipSync(serviceBytes);
  expect(strFromU8(serviceArchive.mimetype)).toBe('application/vnd.oasis.opendocument.text');
  expect(reportText).toContain('檢核結果：通過');
  expect(readmeText).toContain('Preflight 已通過');

  // Sensitive/internal-only values must not escape into any generated public file.
  expect(allPublicText).not.toContain(internalNote);
  expect(allPublicText).not.toContain(reservePrice);
  expect(allPublicText).not.toContain(internalUnitPrice);
});
