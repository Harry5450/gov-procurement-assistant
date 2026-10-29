import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

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

const transientCodes = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN']);

function errorDetails(error) {
  const seen = new Set();
  const details = [];
  function visit(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value.name === 'TimeoutError') details.push('TimeoutError');
    if (value.code) details.push(String(value.code));
    if (value.address || value.port) details.push(`${value.address ?? '?'}:${value.port ?? '?'}`);
    visit(value.cause);
    if (Array.isArray(value.errors)) value.errors.forEach(visit);
  }
  visit(error);
  return [...new Set(details)];
}

export async function fetchIndex({ fetchImpl = fetch, delay = sleep, random = Math.random, log = console.warn } = {}) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(SOURCE_URL, {
        headers: {
          'user-agent': 'GovProcure-Assistant-PCC-Watcher/0.2 (+GitHub Actions)',
          accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${response.statusText}`);
        error.retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const seconds = Number(retryAfter);
          const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
          if (Number.isFinite(ms)) error.retryAfterMs = Math.min(30000, Math.max(0, ms));
        }
        await response.body?.cancel();
        throw error;
      }
      return await response.text();
    } catch (error) {
      const details = errorDetails(error);
      const retryable = error.retryable === true || details.some((detail) => detail === 'TimeoutError' || transientCodes.has(detail));
      const diagnostic = details.length ? ` [${details.join(', ')}]` : '';
      const category = error.retryable !== undefined ? 'HTTP' : retryable ? 'transient network' : 'non-retryable';
      const message = `PCC index fetch attempt ${attempt}/${maxAttempts} failed (${category}): ${error.message}${diagnostic}`;
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`${message}; snapshot not updated.`, { cause: error });
      }
      const waitMs = Math.max(error.retryAfterMs ?? 0, 2000 * 2 ** (attempt - 1) + Math.floor(random() * 1000));
      log(`${message}; retrying in ${waitMs} ms.`);
      await delay(waitMs);
    }
  }
}

export async function refreshIndex({ output = OUTPUT, ...options } = {}) {
  const html = await fetchIndex(options);
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

  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`PCC template index refreshed: ${items.length} rows.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await refreshIndex();
}
