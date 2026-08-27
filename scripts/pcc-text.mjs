import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const ASSET_MANIFEST_PATH = resolve('src/data/pcc-template-assets.json');
const TEXT_MANIFEST_PATH = resolve('src/data/pcc-template-text.json');
const TEXT_ROOT = resolve('src/data/pcc-template-text');
const DRY_RUN = process.argv.includes('--dry-run');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);

  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }

  throw new Error('ZIP end-of-central-directory record not found.');
}

function extractZipEntry(buffer, targetName) {
  const eocd = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocd + 16);
  let offset = centralDirectoryOffset;

  for (let entry = 0; entry < totalEntries; entry += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central-directory header at offset ${offset}.`);
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const filename = buffer.subarray(offset + 46, offset + 46 + filenameLength).toString('utf8');

    if (filename === targetName) {
      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error(`Invalid ZIP local header for ${targetName}.`);
      }

      const localFilenameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);

      if (compressionMethod === 0) return Buffer.from(compressed);
      if (compressionMethod === 8) return inflateRawSync(compressed);
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${targetName}.`);
    }

    offset += 46 + filenameLength + extraLength + commentLength;
  }

  throw new Error(`ZIP entry not found: ${targetName}`);
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function odtXmlToText(xml) {
  const text = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<office:annotation\b[^>]*>[\s\S]*?<\/office:annotation>/gi, '')
    .replace(/<text:line-break\b[^>]*\/>/gi, '\n')
    .replace(/<text:tab\b[^>]*\/>/gi, '\t')
    .replace(/<text:s\b[^>]*text:c=["'](\d+)["'][^>]*\/>/gi, (_, count) => ' '.repeat(Math.min(Number(count), 8)))
    .replace(/<text:s\b[^>]*\/>/gi, ' ')
    .replace(/<\/text:(?:p|h)>/gi, '\n')
    .replace(/<\/table:table-cell>/gi, '\t')
    .replace(/<\/table:table-row>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  const normalized = decodeXml(text)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  return `${normalized}\n`;
}

async function extractOdtText(path) {
  const archive = await readFile(resolve(path));
  const contentXml = extractZipEntry(archive, 'content.xml').toString('utf8');
  return odtXmlToText(contentXml);
}

async function writeImmutableText(path, content) {
  const absolutePath = resolve(path);
  if (await exists(absolutePath)) {
    const existing = await readFile(absolutePath, 'utf8');
    const normalizedExisting = existing.replace(/\r\n?/g, '\n');
    if (normalizedExisting !== content) {
      throw new Error(`Immutable normalized-text violation: ${path} already exists with different content.`);
    }
    return;
  }

  if (!DRY_RUN) {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }
}

const assetManifest = JSON.parse(await readFile(ASSET_MANIFEST_PATH, 'utf8'));
const textManifest = {
  schemaVersion: 1,
  sourceAssetManifest: 'src/data/pcc-template-assets.json',
  templates: [],
};

for (const template of assetManifest.templates ?? []) {
  const versions = [];

  for (const version of template.versions ?? []) {
    const odt = version.files?.find((file) => file.format === 'odt');
    if (!odt) {
      throw new Error(`ODT source missing for ${template.id} ${version.version}; cannot create deterministic text diff.`);
    }

    const content = await extractOdtText(odt.path);
    if (content.trim().length < 100) {
      throw new Error(`Normalized text is unexpectedly short for ${template.id} ${version.version}.`);
    }

    const versionPath = `src/data/pcc-template-text/versions/${template.id}/${version.version}.txt`;
    await writeImmutableText(versionPath, content);

    versions.push({
      version: version.version,
      textPath: versionPath,
      textSha256: sha256(content),
      lineCount: content.split('\n').filter(Boolean).length,
      sourceOdtPath: odt.path,
      sourceOdtSha256: odt.sha256,
    });
  }

  versions.sort((a, b) => Number(b.version) - Number(a.version));
  const latest = versions[0];
  if (!latest) continue;

  const latestContent = await readFile(resolve(latest.sourceOdtPath)).then((archive) => {
    const contentXml = extractZipEntry(archive, 'content.xml').toString('utf8');
    return odtXmlToText(contentXml);
  });
  const latestPath = `src/data/pcc-template-text/latest/${template.id}.txt`;

  if (!DRY_RUN) {
    await mkdir(dirname(resolve(latestPath)), { recursive: true });
    await writeFile(resolve(latestPath), latestContent, 'utf8');
  }

  textManifest.templates.push({
    id: template.id,
    name: template.name,
    latestVersion: latest.version,
    latestTextPath: latestPath,
    latestTextSha256: latest.textSha256,
    versions,
  });

  console.log(`${template.name}: normalized ${versions.length} archived version(s); latest ${latest.version}, ${latest.lineCount} lines.`);
}

if (textManifest.templates.length === 0) {
  throw new Error('No PCC templates were normalized. Asset manifest is empty.');
}

if (!DRY_RUN) {
  await mkdir(TEXT_ROOT, { recursive: true });
  await writeFile(TEXT_MANIFEST_PATH, `${JSON.stringify(textManifest, null, 2)}\n`, 'utf8');
  console.log('PCC normalized-text manifest refreshed.');
} else {
  console.log('Dry run complete; normalized text was verified without writing files.');
}
