import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const INDEX_PATH = resolve('src/data/pcc-template-index.json');
const MANIFEST_PATH = resolve('src/data/pcc-template-assets.json');
const STORE_ROOT = resolve('official-templates');
const DRY_RUN = process.argv.includes('--dry-run');

const CORE_TEMPLATES = [
  { id: 'tender-instructions', name: '投標須知範本' },
  { id: 'construction-contract', name: '工程採購契約範本' },
  { id: 'goods-contract', name: '財物採購契約範本' },
  { id: 'service-contract', name: '勞務採購契約範本' },
];

function decodeHtml(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function textContent(value) {
  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path, fallback) {
  if (!(await exists(path))) return fallback;
  return JSON.parse(await readFile(path, 'utf8'));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'GovProcure-Assistant-PCC-Asset-Watcher/0.1 (+GitHub Actions)',
      accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`PCC detail request failed: ${response.status} ${response.statusText} (${url})`);
  }

  return response.text();
}

function parseLatestPrimaryAssetGroup(html, templateName, detailUrl) {
  const candidates = [];
  const itemPattern = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  const exactPrimaryPattern = new RegExp(`^${escapeRegExp(templateName)}\\s*[（(](1\\d{6})[）)]\\s*$`);

  for (const itemMatch of html.matchAll(itemPattern)) {
    const itemHtml = itemMatch[1];
    if (!/downloadFile\?/i.test(itemHtml)) continue;

    const firstAnchor = itemHtml.search(/<a\b/i);
    if (firstAnchor < 0) continue;

    const title = textContent(itemHtml.slice(0, firstAnchor));
    const titleMatch = title.match(exactPrimaryPattern);
    if (!titleMatch) continue;

    const version = titleMatch[1];
    const files = [];
    const linkPattern = /<a\b[^>]*\bhref=["']([^"']*downloadFile\?[^"']+)["'][^>]*>/gi;

    for (const linkMatch of itemHtml.matchAll(linkPattern)) {
      const sourceUrl = new URL(decodeHtml(linkMatch[1]), detailUrl).toString();
      const parsed = new URL(sourceUrl);
      const officialFilename = parsed.searchParams.get('sname') ?? '';
      const extensionMatch = officialFilename.match(/\.([a-z0-9]+)$/i);
      const format = extensionMatch?.[1]?.toLowerCase();
      if (!format || !['docx', 'odt', 'pdf'].includes(format)) continue;
      files.push({ format, officialFilename, sourceUrl });
    }

    const formats = new Set(files.map((file) => file.format));
    if (['docx', 'odt', 'pdf'].every((format) => formats.has(format))) {
      candidates.push({ version, title, files });
    }
  }

  candidates.sort((a, b) => Number(b.version) - Number(a.version));
  const latest = candidates[0];
  if (!latest) {
    throw new Error(`No complete DOCX/ODT/PDF primary asset group found for ${templateName} (${detailUrl}).`);
  }

  return latest;
}

function validateFile(buffer, format, sourceUrl) {
  if (buffer.length < 128) {
    throw new Error(`Downloaded file is unexpectedly small (${buffer.length} bytes): ${sourceUrl}`);
  }

  if (format === 'pdf' && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error(`Downloaded PDF failed signature validation: ${sourceUrl}`);
  }

  if ((format === 'docx' || format === 'odt') && buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    throw new Error(`Downloaded ${format.toUpperCase()} failed ZIP signature validation: ${sourceUrl}`);
  }
}

async function downloadFile(file) {
  const response = await fetch(file.sourceUrl, {
    headers: {
      'user-agent': 'GovProcure-Assistant-PCC-Asset-Watcher/0.1 (+GitHub Actions)',
      accept: 'application/octet-stream,*/*',
    },
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    throw new Error(`PCC file download failed: ${response.status} ${response.statusText} (${file.sourceUrl})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  validateFile(buffer, file.format, file.sourceUrl);
  return buffer;
}

async function persistImmutableFile({ id, version, file, buffer }) {
  const relativePath = `official-templates/${id}/${version}/${id}.${file.format}`;
  const absolutePath = resolve(relativePath);
  const digest = sha256(buffer);

  if (await exists(absolutePath)) {
    const existing = await readFile(absolutePath);
    const existingDigest = sha256(existing);
    if (existingDigest !== digest) {
      throw new Error(
        `Immutable PCC asset violation: ${relativePath} already exists with SHA-256 ${existingDigest}, ` +
        `but PCC now serves ${digest} for the same version. Manual investigation required.`,
      );
    }
  } else if (!DRY_RUN) {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
  }

  return {
    format: file.format,
    path: relativePath,
    sha256: digest,
    size: buffer.length,
    sourceUrl: file.sourceUrl,
    officialFilename: file.officialFilename,
  };
}

const index = await readJson(INDEX_PATH, null);
if (!index?.items?.length) {
  throw new Error('PCC index snapshot is missing or empty. Run npm run pcc:watch first.');
}

const manifest = await readJson(MANIFEST_PATH, {
  schemaVersion: 1,
  sourceIndexUrl: index.sourceUrl,
  templates: [],
});

manifest.schemaVersion = 1;
manifest.sourceIndexUrl = index.sourceUrl;
manifest.templates ??= [];

for (const template of CORE_TEMPLATES) {
  const observation = index.items.find((item) => item.name?.trim() === template.name);
  if (!observation?.detailUrl) {
    throw new Error(`PCC detail URL missing for ${template.name}. Run the current pcc:watch parser first.`);
  }

  const html = await fetchText(observation.detailUrl);
  const latest = parseLatestPrimaryAssetGroup(html, template.name, observation.detailUrl);
  const files = [];

  for (const file of latest.files) {
    const buffer = await downloadFile(file);
    files.push(await persistImmutableFile({ id: template.id, version: latest.version, file, buffer }));
  }

  files.sort((a, b) => a.format.localeCompare(b.format));

  let templateManifest = manifest.templates.find((item) => item.id === template.id);
  if (!templateManifest) {
    templateManifest = {
      id: template.id,
      name: template.name,
      detailUrl: observation.detailUrl,
      latestObservedVersion: latest.version,
      versions: [],
    };
    manifest.templates.push(templateManifest);
  }

  templateManifest.name = template.name;
  templateManifest.detailUrl = observation.detailUrl;
  templateManifest.latestObservedVersion = latest.version;
  templateManifest.versions ??= [];

  const existingVersion = templateManifest.versions.find((item) => item.version === latest.version);
  if (existingVersion) {
    for (const file of files) {
      const recorded = existingVersion.files?.find((item) => item.format === file.format);
      if (recorded?.sha256 && recorded.sha256 !== file.sha256) {
        throw new Error(
          `Immutable manifest violation for ${template.id} ${latest.version} ${file.format}: ` +
          `${recorded.sha256} -> ${file.sha256}. Manual investigation required.`,
        );
      }
    }
    existingVersion.title = latest.title;
    existingVersion.files = files;
  } else {
    templateManifest.versions.push({
      version: latest.version,
      title: latest.title,
      files,
    });
  }

  templateManifest.versions.sort((a, b) => Number(b.version) - Number(a.version));
  console.log(`${template.name}: latest detail-page version ${latest.version}; ${files.length} files verified.`);
}

manifest.templates.sort((a, b) => CORE_TEMPLATES.findIndex((item) => item.id === a.id) - CORE_TEMPLATES.findIndex((item) => item.id === b.id));

if (!DRY_RUN) {
  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await mkdir(STORE_ROOT, { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('PCC immutable asset manifest refreshed.');
} else {
  console.log('Dry run complete; no files or manifest were written.');
}
