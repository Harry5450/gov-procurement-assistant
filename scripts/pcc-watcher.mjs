import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SOURCE_URL = 'https://www.pcc.gov.tw/content/index?eid=10146&lang=1&type=C';
const OUTPUT = resolve('src/data/pcc-template-index.json');

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

function firstHref(value) {
  const match = value.match(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  return match ? decodeHtml(match[1]) : undefined;
}

function parseRows(html) {
  const rows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellPattern = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;

  for (const rowMatch of html.matchAll(rowPattern)) {
    const cellHtml = [...rowMatch[1].matchAll(cellPattern)].map((match) => match[1]);
    const cells = cellHtml.map(textContent);
    if (cells.length < 3) continue;

    const sequence = Number(cells[0]);
    if (!Number.isInteger(sequence) || sequence <= 0) continue;

    const name = cells[1];
    const officialDate = cells[2];
    if (!name) continue;

    const href = firstHref(cellHtml[1] ?? '');
    const detailUrl = href ? new URL(href, SOURCE_URL).toString() : undefined;

    rows.push({ sequence, name, officialDate, ...(detailUrl ? { detailUrl } : {}) });
  }

  return rows.sort((a, b) => a.sequence - b.sequence);
}

const response = await fetch(SOURCE_URL, {
  headers: {
    'user-agent': 'GovProcure-Assistant-PCC-Watcher/0.2 (+GitHub Actions)',
    accept: 'text/html,application/xhtml+xml',
  },
  signal: AbortSignal.timeout(30000),
});

if (!response.ok) {
  throw new Error(`PCC request failed: ${response.status} ${response.statusText}`);
}

const html = await response.text();
const items = parseRows(html);

if (items.length < 20) {
  throw new Error(`PCC parser safety check failed: only ${items.length} rows were found; refusing to overwrite snapshot.`);
}

const coreNames = ['投標須知範本', '工程採購契約範本', '財物採購契約範本', '勞務採購契約範本'];
const missingCore = coreNames.filter((name) => !items.some((item) => item.name === name));
if (missingCore.length > 0) {
  throw new Error(`PCC parser safety check failed: missing core templates: ${missingCore.join(', ')}`);
}

const missingDetailUrl = coreNames.filter((name) => !items.find((item) => item.name === name)?.detailUrl);
if (missingDetailUrl.length > 0) {
  throw new Error(`PCC parser safety check failed: missing detail URLs for core templates: ${missingDetailUrl.join(', ')}`);
}

const payload = {
  sourceUrl: SOURCE_URL,
  items,
};

await writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`PCC template index refreshed: ${items.length} rows.`);
