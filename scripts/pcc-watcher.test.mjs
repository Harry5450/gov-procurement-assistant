import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchIndex, refreshIndex } from './pcc-watcher.mjs';

const timeout = () => Object.assign(new Error('fetch failed'), {
  cause: new AggregateError([
    Object.assign(new Error('IPv4 timeout'), { code: 'ETIMEDOUT', address: '223.200.177.8', port: 443 }),
    Object.assign(new Error('IPv6 unreachable'), { code: 'ENETUNREACH' }),
  ]),
});
const opts = { delay: async () => {}, random: () => 0, log: () => {} };
const response = (status, body = '', headers = {}) => new Response(body, { status, headers });

test('retries transient connection failures with bounded exponential backoff and diagnostics', async () => {
  let attempts = 0;
  const waits = [], logs = [];
  const result = await fetchIndex({ ...opts, fetchImpl: async () => {
    if (++attempts < 3) throw timeout();
    return response(200, 'ok');
  }, delay: async (ms) => waits.push(ms), log: (line) => logs.push(line) });
  assert.equal(result, 'ok');
  assert.deepEqual(waits, [2000, 4000]);
  assert.match(logs[0], /ETIMEDOUT.*223\.200\.177\.8:443.*ENETUNREACH/);
});

test('retries transient HTTP and honors bounded Retry-After', async () => {
  let attempts = 0;
  const waits = [];
  await fetchIndex({ ...opts, fetchImpl: async () => ++attempts === 1 ? response(429, '', { 'retry-after': '120' }) : response(200, 'ok'), delay: async (ms) => waits.push(ms) });
  assert.deepEqual(waits, [30000]);
});

test('does not retry permanent HTTP or TLS errors', async () => {
  for (const fetchImpl of [async () => response(404), async () => { throw Object.assign(new Error('TLS failure'), { code: 'CERT_HAS_EXPIRED' }); }]) {
    let attempts = 0;
    await assert.rejects(fetchIndex({ ...opts, fetchImpl: async (...args) => { attempts++; return fetchImpl(...args); } }), /snapshot not updated/);
    assert.equal(attempts, 1);
  }
});

test('failed fetch and invalid page do not change snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pcc-watch-'));
  const output = join(dir, 'snapshot.json');
  try {
    await writeFile(output, 'original');
    let attempts = 0;
    await assert.rejects(refreshIndex({ ...opts, output, fetchImpl: async () => { attempts++; throw timeout(); } }), /attempt 3\/3.*snapshot not updated/);
    assert.equal(attempts, 3);
    assert.equal(await readFile(output, 'utf8'), 'original');
    await assert.rejects(refreshIndex({ ...opts, output, fetchImpl: async () => response(200, '<html>unavailable</html>') }), /parser safety check/);
    assert.equal(await readFile(output, 'utf8'), 'original');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('valid index updates only after core and detail validation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pcc-watch-'));
  const output = join(dir, 'snapshot.json');
  const core = ['投標須知範本', '工程採購契約範本', '財物採購契約範本', '勞務採購契約範本'];
  const rows = Array.from({ length: 20 }, (_, i) => `<tr><td>${i + 1}</td><td><a href="/detail/${i}">${core[i] ?? `文件${i}`}</a></td><td>115/10/28</td></tr>`).join('');
  try {
    await refreshIndex({ ...opts, output, fetchImpl: async () => response(200, `<table>${rows}</table>`) });
    assert.equal(JSON.parse(await readFile(output, 'utf8')).items.length, 20);
    await writeFile(output, 'original');
    await assert.rejects(refreshIndex({ ...opts, output, fetchImpl: async () => response(200, `<table>${rows.replace('href="/detail/0"', '')}</table>`) }), /missing detail URLs/);
    assert.equal(await readFile(output, 'utf8'), 'original');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
