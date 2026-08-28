import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_TEMPLATE_IDS = new Set([
  'tender-instructions',
  'service-contract',
  'goods-contract',
  'construction-contract',
]);

const WRITER_REFERENCES = {
  'tender-instructions': [
    ['src/template-writer.ts', (version) => `const TENDER_TEMPLATE_VERSION = '${version}'`],
    ['src/template-writer.ts', (version) => `official-templates/tender-instructions/${version}/`],
    ['scripts/template-anchor-audit.mjs', (version) => `official-templates/tender-instructions/${version}/`],
    ['scripts/template-writer-smoke.mjs', (version) => `official-templates/tender-instructions/${version}/`],
  ],
  'service-contract': [
    ['src/service-contract-writer.ts', (version) => `const SERVICE_TEMPLATE_VERSION = '${version}'`],
    ['src/service-contract-writer.ts', (version) => `official-templates/service-contract/${version}/`],
    ['scripts/template-anchor-audit.mjs', (version) => `official-templates/service-contract/${version}/`],
    ['scripts/template-writer-smoke.mjs', (version) => `official-templates/service-contract/${version}/`],
  ],
};

const PRIMARY_WRITER_FILES = {
  'tender-instructions': 'src/template-writer.ts',
  'service-contract': 'src/service-contract-writer.ts',
};

export function validateTemplateId(templateId) {
  if (!ALLOWED_TEMPLATE_IDS.has(templateId)) {
    throw new Error(`不支援的範本 ID：${templateId || '（空白）'}`);
  }
  return templateId;
}

export function formatRocVersion(version) {
  if (!/^\d{7}$/.test(version)) throw new Error('版本必須是 7 碼民國日期，例如 1150727。');
  return `${version.slice(0, 3)}/${version.slice(3, 5)}/${version.slice(5, 7)}`;
}

function findRegistryBlock(source, templateId) {
  validateTemplateId(templateId);
  const idMarker = `id: '${templateId}',`;
  const idIndex = source.indexOf(idMarker);
  if (idIndex < 0) throw new Error(`active Registry 找不到範本：${templateId}`);

  const blockStart = source.lastIndexOf('  {', idIndex);
  const nextBlock = source.indexOf('\n  {', idIndex + idMarker.length);
  const registryEnd = source.indexOf('\n];', idIndex + idMarker.length);
  const blockEnd = nextBlock >= 0 && (registryEnd < 0 || nextBlock < registryEnd) ? nextBlock : registryEnd;
  if (blockStart < 0 || blockEnd < 0) throw new Error(`active Registry 範本區塊格式不正確：${templateId}`);

  const block = source.slice(blockStart, blockEnd);
  const dateMatch = block.match(/officialDate:\s*'([^']+)'/);
  if (!dateMatch) throw new Error(`active Registry 缺少 officialDate：${templateId}`);
  return { block, blockStart, blockEnd, dateMatch };
}

export function getActiveRegistryVersion(source, templateId) {
  const { dateMatch } = findRegistryBlock(source, templateId);
  const version = dateMatch[1].replace(/\D/g, '');
  formatRocVersion(version);
  return version;
}

export function updateActiveRegistry(source, templateId, version) {
  const formattedVersion = formatRocVersion(version);
  const { block, blockStart, blockEnd, dateMatch } = findRegistryBlock(source, templateId);
  const previousVersion = dateMatch[1];
  if (previousVersion === formattedVersion) {
    return { text: source, changed: false, previousVersion, activeVersion: formattedVersion };
  }

  const nextBlockText = block.replace(dateMatch[0], `officialDate: '${formattedVersion}'`);
  return {
    text: `${source.slice(0, blockStart)}${nextBlockText}${source.slice(blockEnd)}`,
    changed: true,
    previousVersion,
    activeVersion: formattedVersion,
  };
}

function replaceExpected(source, from, to, label, expectedCount = 1) {
  const count = source.split(from).length - 1;
  if (count !== expectedCount) throw new Error(`${label} 預期 ${expectedCount} 個版號定位，實際找到 ${count} 個。`);
  return source.replaceAll(from, to);
}

export function updateAnchorAuditVersion(source, templateId, fromVersion, toVersion) {
  const idMarker = `id: '${templateId}',`;
  const idIndex = source.indexOf(idMarker);
  if (idIndex < 0) throw new Error(`Anchor audit 找不到範本：${templateId}`);
  const blockStart = source.lastIndexOf('  {', idIndex);
  const nextBlock = source.indexOf('\n  {', idIndex + idMarker.length);
  const arrayEnd = source.indexOf('\n];', idIndex + idMarker.length);
  const blockEnd = nextBlock >= 0 && (arrayEnd < 0 || nextBlock < arrayEnd) ? nextBlock : arrayEnd;
  if (blockStart < 0 || blockEnd < 0) throw new Error(`Anchor audit 範本區塊格式不正確：${templateId}`);
  const block = source.slice(blockStart, blockEnd);
  const updatedBlock = replaceExpected(block, fromVersion, toVersion, `${templateId} Anchor audit`, 2);
  return `${source.slice(0, blockStart)}${updatedBlock}${source.slice(blockEnd)}`;
}

export function updateSmokeVersion(source, templateId, fromVersion, toVersion) {
  if (templateId === 'tender-instructions') {
    let updated = replaceExpected(
      source,
      `official-templates/tender-instructions/${fromVersion}/`,
      `official-templates/tender-instructions/${toVersion}/`,
      'tender smoke path',
    );
    updated = replaceExpected(updated, `verified in ${fromVersion} DOCX`, `verified in ${toVersion} DOCX`, 'tender smoke message');
    return updated;
  }
  if (templateId === 'service-contract') {
    let updated = replaceExpected(
      source,
      `official-templates/service-contract/${fromVersion}/`,
      `official-templates/service-contract/${toVersion}/`,
      'service smoke path',
    );
    updated = replaceExpected(updated, `verified in ${fromVersion} ODT`, `verified in ${toVersion} ODT`, 'service smoke message');
    return updated;
  }
  return source;
}

async function prepareWriterPointerChanges(repoRoot, templateId, fromVersion, toVersion) {
  const changes = [];
  const writerPath = PRIMARY_WRITER_FILES[templateId];
  if (!writerPath) return changes;

  const writerSource = await readFile(resolve(repoRoot, writerPath), 'utf8');
  const writerCount = writerSource.split(fromVersion).length - 1;
  if (writerCount < 2) throw new Error(`${writerPath} 未完整指向目前 active ${fromVersion}。`);
  changes.push({ path: writerPath, text: writerSource.replaceAll(fromVersion, toVersion) });

  const anchorPath = 'scripts/template-anchor-audit.mjs';
  const anchorSource = await readFile(resolve(repoRoot, anchorPath), 'utf8');
  changes.push({ path: anchorPath, text: updateAnchorAuditVersion(anchorSource, templateId, fromVersion, toVersion) });

  const smokePath = 'scripts/template-writer-smoke.mjs';
  const smokeSource = await readFile(resolve(repoRoot, smokePath), 'utf8');
  changes.push({ path: smokePath, text: updateSmokeVersion(smokeSource, templateId, fromVersion, toVersion) });
  return changes;
}

async function validateArchivedCandidate(repoRoot, templateId, version) {
  const manifestPath = resolve(repoRoot, 'src/data/pcc-template-assets.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const record = manifest.templates?.find((item) => item.id === templateId);
  if (!record) throw new Error(`封存 Manifest 找不到範本：${templateId}`);
  if (record.latestObservedVersion !== version) {
    throw new Error(`指定版本 ${version} 不是最新觀測版本 ${record.latestObservedVersion}，停止升版。`);
  }
  const archivedVersion = record.versions?.find((item) => item.version === version);
  if (!archivedVersion?.files?.length) throw new Error(`版本 ${version} 尚未完整封存官方檔案。`);

  const formats = new Set(archivedVersion.files.map((file) => file.format));
  if (!formats.has('odt') || !formats.has('pdf') || (!formats.has('doc') && !formats.has('docx'))) {
    throw new Error(`版本 ${version} 缺少可編輯原檔、ODT 或 PDF，停止升版。`);
  }

  const indexManifest = JSON.parse(await readFile(resolve(repoRoot, 'src/data/pcc-template-index.json'), 'utf8'));
  const observation = indexManifest.items?.find((item) => item.name?.trim() === record.name?.trim());
  if (!observation || observation.officialDate?.replace(/\D/g, '') !== version) {
    throw new Error(`官方索引尚未將 ${record.name} 標示為 ${version}。`);
  }
  if (!observation.detailUrl || canonicalUrl(observation.detailUrl) !== canonicalUrl(record.detailUrl)) {
    throw new Error(`${templateId}@${version} 的官方 detail URL 與封存 Manifest 不一致。`);
  }

  const textManifest = JSON.parse(await readFile(resolve(repoRoot, 'src/data/pcc-template-text.json'), 'utf8'));
  const textRecord = textManifest.templates?.find((item) => item.id === templateId);
  const textVersion = textRecord?.versions?.find((item) => item.version === version);
  if (textRecord?.latestVersion !== version || !textVersion) {
    throw new Error(`${templateId}@${version} 尚未成為 normalized text 的最新封存版本。`);
  }

  const expectedPrefix = `official-templates/${templateId}/${version}/`;
  for (const file of archivedVersion.files) {
    if (typeof file.path !== 'string' || !file.path.startsWith(expectedPrefix)) {
      throw new Error(`封存檔案路徑不在預期版本目錄：${file.path ?? '（缺少路徑）'}`);
    }
    const absolutePath = resolve(repoRoot, file.path);
    const relativePath = relative(repoRoot, absolutePath);
    if (relativePath.startsWith('..') || relativePath === '') throw new Error(`封存檔案路徑不安全：${file.path}`);
    const buffer = await readFile(absolutePath);
    if (buffer.byteLength !== file.size) throw new Error(`${file.path} 檔案大小與 Manifest 不符。`);
    if (createHash('sha256').update(buffer).digest('hex') !== file.sha256) {
      throw new Error(`${file.path} SHA-256 與 Manifest 不符。`);
    }
  }

  await assertFileHash(repoRoot, textVersion.textPath, textVersion.textSha256, 'normalized text', true);
  await assertFileHash(repoRoot, textVersion.sourceOdtPath, textVersion.sourceOdtSha256, 'source ODT');
  const sourceOdtAsset = archivedVersion.files.find((file) => file.path === textVersion.sourceOdtPath);
  if (!sourceOdtAsset || sourceOdtAsset.sha256 !== textVersion.sourceOdtSha256) {
    throw new Error(`${templateId}@${version} 的 normalized text 與官方 ODT 對應不一致。`);
  }
}

function canonicalUrl(value) {
  const url = new URL(value);
  url.searchParams.sort();
  return url.toString();
}

async function assertFileHash(repoRoot, path, expectedHash, label, normalizeText = false) {
  const absolutePath = resolve(repoRoot, path);
  const relativePath = relative(repoRoot, absolutePath);
  if (relativePath.startsWith('..') || relativePath === '') throw new Error(`${label} 路徑不安全：${path}`);
  const buffer = await readFile(absolutePath);
  const content = normalizeText ? buffer.toString('utf8').replace(/\r\n?/g, '\n') : buffer;
  const actualHash = createHash('sha256').update(content).digest('hex');
  if (actualHash !== expectedHash) throw new Error(`${label} SHA-256 與 Manifest 不符：${path}`);
}

export async function validateWriterReferences(repoRoot, templateId, version) {
  const references = WRITER_REFERENCES[templateId] ?? [];
  for (const [path, marker] of references) {
    const source = await readFile(resolve(repoRoot, path), 'utf8');
    if (!source.includes(marker(version))) {
      throw new Error(`${path} 尚未切換到 ${templateId}@${version}；請先更新 Writer 與 Anchor 測試。`);
    }
  }
}

export async function promotePccTemplate({
  repoRoot = REPO_ROOT,
  templateId,
  version,
  write = false,
}) {
  validateTemplateId(templateId);
  formatRocVersion(version);
  await validateArchivedCandidate(repoRoot, templateId, version);

  const registryPath = resolve(repoRoot, 'src/templates.ts');
  const registrySource = await readFile(registryPath, 'utf8');
  const currentActiveVersion = getActiveRegistryVersion(registrySource, templateId);
  const result = updateActiveRegistry(registrySource, templateId, version);
  if (!result.changed) {
    await validateWriterReferences(repoRoot, templateId, version);
    return { ...result, changedFiles: [] };
  }

  await validateWriterReferences(repoRoot, templateId, currentActiveVersion);
  const pointerChanges = await prepareWriterPointerChanges(repoRoot, templateId, currentActiveVersion, version);
  const changes = [{ path: 'src/templates.ts', text: result.text }, ...pointerChanges];
  if (write) {
    for (const change of changes) await writeFile(resolve(repoRoot, change.path), change.text, 'utf8');
    await validateWriterReferences(repoRoot, templateId, version);
  }
  return { ...result, changedFiles: changes.map((change) => change.path) };
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

async function main() {
  const templateId = readArgument('--template');
  const version = readArgument('--version');
  const write = process.argv.includes('--write');
  const result = await promotePccTemplate({ templateId, version, write });
  if (!result.changed) {
    console.log(`${templateId}@${version} 已是 active，無需建立升版 PR。`);
    return;
  }
  console.log(`${templateId} active：${result.previousVersion} → ${result.activeVersion}${write ? '（已更新工作樹）' : '（check only）'}`);
  console.log(`預計變更：${result.changedFiles.join('、')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
