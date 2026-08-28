import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getActiveRegistryVersion,
  validateWriterReferences,
} from './pcc-promote.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_IDS = [
  'tender-instructions',
  'service-contract',
  'goods-contract',
  'construction-contract',
];

function safeRepositoryPath(path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('Manifest 含有空白檔案路徑。');
  const absolutePath = resolve(REPO_ROOT, path);
  const relativePath = relative(REPO_ROOT, absolutePath);
  if (relativePath.startsWith('..') || relativePath === '') throw new Error(`Manifest 檔案路徑不安全：${path}`);
  return absolutePath;
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function assertHash(path, expectedHash, label, normalizeText = false) {
  const absolutePath = safeRepositoryPath(path);
  const actualHash = normalizeText
    ? createHash('sha256').update((await readFile(absolutePath, 'utf8')).replace(/\r\n?/g, '\n')).digest('hex')
    : await sha256(absolutePath);
  if (actualHash !== expectedHash) throw new Error(`${label} SHA-256 不符：${path}`);
}

export async function auditActivePccRegistry() {
  const registrySource = await readFile(resolve(REPO_ROOT, 'src/templates.ts'), 'utf8');
  const assetManifest = JSON.parse(await readFile(resolve(REPO_ROOT, 'src/data/pcc-template-assets.json'), 'utf8'));
  const textManifest = JSON.parse(await readFile(resolve(REPO_ROOT, 'src/data/pcc-template-text.json'), 'utf8'));
  const indexManifest = JSON.parse(await readFile(resolve(REPO_ROOT, 'src/data/pcc-template-index.json'), 'utf8'));
  const results = [];

  for (const templateId of TEMPLATE_IDS) {
    const activeVersion = getActiveRegistryVersion(registrySource, templateId);
    const assetRecord = assetManifest.templates?.find((item) => item.id === templateId);
    const textRecord = textManifest.templates?.find((item) => item.id === templateId);
    const observation = indexManifest.items?.find((item) => item.name?.trim() === assetRecord?.name?.trim());
    const observedVersion = observation?.officialDate?.replace(/\D/g, '');
    if (!assetRecord || !textRecord || observedVersion !== assetRecord.latestObservedVersion || textRecord.latestVersion !== assetRecord.latestObservedVersion) {
      throw new Error(`${templateId} 的官方索引、檔案封存與 normalized text 最新版本不一致。`);
    }
    if (!observation.detailUrl || canonicalUrl(observation.detailUrl) !== canonicalUrl(assetRecord.detailUrl)) {
      throw new Error(`${templateId} 的官方 detail URL 與封存 Manifest 不一致。`);
    }
    await assertHash(textRecord.latestTextPath, textRecord.latestTextSha256, `${templateId} latest normalized text`, true);

    const assetVersion = assetRecord?.versions?.find((item) => item.version === activeVersion);
    if (!assetVersion?.files?.length) throw new Error(`${templateId}@${activeVersion} 不存在於官方檔案封存 Manifest。`);
    if (new Set(assetRecord.versions.map((item) => item.version)).size !== assetRecord.versions.length) {
      throw new Error(`${templateId} 的官方檔案封存 Manifest 含有重複版本。`);
    }
    if (new Set(textRecord.versions.map((item) => item.version)).size !== textRecord.versions.length) {
      throw new Error(`${templateId} 的 normalized text Manifest 含有重複版本。`);
    }
    const formats = new Set(assetVersion.files.map((file) => file.format));
    if (!formats.has('odt') || !formats.has('pdf') || (!formats.has('doc') && !formats.has('docx'))) {
      throw new Error(`${templateId}@${activeVersion} 缺少可編輯原檔、ODT 或 PDF。`);
    }

    for (const file of assetVersion.files) {
      const fileBuffer = await readFile(safeRepositoryPath(file.path));
      if (fileBuffer.byteLength !== file.size) throw new Error(`${file.path} 檔案大小與 Manifest 不符。`);
      const actualHash = createHash('sha256').update(fileBuffer).digest('hex');
      if (actualHash !== file.sha256) throw new Error(`${file.path} SHA-256 與 Manifest 不符。`);
    }

    const textVersion = textRecord?.versions?.find((item) => item.version === activeVersion);
    if (!textVersion) throw new Error(`${templateId}@${activeVersion} 不存在於 normalized text Manifest。`);
    await assertHash(textVersion.textPath, textVersion.textSha256, `${templateId} normalized text`, true);
    await assertHash(textVersion.sourceOdtPath, textVersion.sourceOdtSha256, `${templateId} source ODT`);
    const sourceOdtAsset = assetVersion.files.find((file) => file.path === textVersion.sourceOdtPath);
    if (!sourceOdtAsset || sourceOdtAsset.sha256 !== textVersion.sourceOdtSha256) {
      throw new Error(`${templateId}@${activeVersion} 的 normalized text 與官方 ODT 對應不一致。`);
    }
    await validateWriterReferences(REPO_ROOT, templateId, activeVersion);

    results.push({ templateId, activeVersion, fileCount: assetVersion.files.length });
  }
  return results;
}

function canonicalUrl(value) {
  const url = new URL(value);
  url.searchParams.sort();
  return url.toString();
}

auditActivePccRegistry()
  .then((results) => {
    for (const result of results) {
      console.log(`${result.templateId}@${result.activeVersion}: active archive/text/writer audit OK (${result.fileCount} files).`);
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
