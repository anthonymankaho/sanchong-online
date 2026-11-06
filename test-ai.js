/* AI assistant backend tests (matches src/ai.js contract).
 *   node test-ai.js functional <base> [mockUrl]
 *   node test-ai.js trip <base>        # quota row pre-set high -> expect 402 twice (no refresh)
 *   node test-ai.js nokey <base>       # no DASHSCOPE_API_KEY -> configured=false + chat 503
 */
const MODE = process.argv[2];
const BASE = process.argv[3];
const MOCK = process.argv[4] || 'http://127.0.0.1:9999';

let pass = 0, fail = 0; const fails = [];
function ok(c, n, x) { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; fails.push(n + (x ? ' :: ' + x : '')); console.log('  FAIL ' + n + (x ? ' >> ' + x : '')); } }
function sec(t) { console.log('\n=== ' + t + ' ==='); }
async function j(p, o) { const r = await fetch(BASE + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, o)); let d = null; try { d = await r.json(); } catch (e) {} return { s: r.status, d }; }
async function mj(p, o) { const r = await fetch(MOCK + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, o)); let d = null; try { d = await r.json(); } catch (e) {} return { s: r.status, d }; }
const setMode = (mode, id) => mj('/__mode', { method: 'POST', body: JSON.stringify({ mode, id }) });
const chat = (msg) => j('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message: msg }) });

(async () => {
  if (MODE === 'nokey') {
    const q = await j('/api/ai/quota');
    ok(q.d.configured === false, 'configured=false without key');
    const c = await chat('x');
    ok(c.s === 503 && c.d.error === 'ai_not_configured', 'chat -> 503 ai_not_configured', JSON.stringify(c.d));
  } else if (MODE === 'trip') {
    const c1 = await chat('one');
    const c2 = await chat('two');
    ok(c1.s === 402 && c1.d.error === 'quota_exhausted', 'first call 402 (pre-set exhausted)', String(c1.s));
    ok(c2.s === 402, 'stays failed-closed, no refresh', String(c2.s));
  } else {
    // ---------- functional ----------
    const list0 = await j('/api/units');
    for (const u of list0.d || []) await j('/api/units/' + u.id, { method: 'DELETE' });

    sec('quota endpoint');
    const q = await j('/api/ai/quota');
    ok(q.s === 200 && q.d.configured === true, 'configured=true when key present');
    ok(q.d.quota.limit === 5000000, 'default quota = 5,000,000', String(q.d.quota.limit));
    ok(q.d.quota.refresh === false, 'quota does NOT refresh', String(q.d.quota.refresh));

    sec('no mutation before apply + update flow');
    const c = await j('/api/units', { method: 'POST', body: JSON.stringify({ estate: '測試盤', price: 500000, overall: 8 }) });
    const id = c.d.id;
    await setMode('update', id);
    const ch = await chat('應唔應該減價？');
    ok(ch.s === 200, 'chat 200', String(ch.s));
    ok(ch.d.operations.length === 1 && ch.d.operations[0].op === 'update_unit', 'one update_unit op returned');
    const op = ch.d.operations[0];
    ok(op.old && op.old.price === 500000, 'op carries old value for diff', JSON.stringify(op.old));
    ok(typeof op.sig === 'string' && op.sig.length === 64, 'op carries sha256 sig');
    let u = await j('/api/units/' + id);
    ok(u.d.price === 500000, 'DB NOT mutated by chat (no auto-apply)', String(u.d.price));
    const applied = await j('/api/ai/apply', { method: 'POST', body: JSON.stringify({ operations: [op] }) });
    ok(applied.s === 200, 'apply 200', JSON.stringify(applied.d));
    u = await j('/api/units/' + id);
    ok(u.d.price === 450000, 'price updated after explicit apply', String(u.d.price));

    sec('stale preview rejected');
    await setMode('update', id);
    const ch2 = await chat('再改');
    await j('/api/units/' + id, { method: 'PUT', body: JSON.stringify({ estate: '測試盤', price: 999999 }) });
    const stale = await j('/api/ai/apply', { method: 'POST', body: JSON.stringify({ operations: ch2.d.operations }) });
    ok(stale.s === 409, 'stale sig -> 409 whole batch', String(stale.s));
    u = await j('/api/units/' + id);
    ok(u.d.price === 999999, 'stale apply changed nothing', String(u.d.price));

    sec('create flow');
    await setMode('create', id);
    const ch3 = await chat('加多盤');
    ok(ch3.d.operations[0].op === 'create_unit', 'create_unit op');
    const ap3 = await j('/api/ai/apply', { method: 'POST', body: JSON.stringify({ operations: ch3.d.operations }) });
    const newId = ap3.d.applied[0].id;
    const nu = await j('/api/units/' + newId);
    ok(nu.d.estate === 'AI新盤' && nu.d.price === 100000, 'created unit persisted', nu.d.estate);

    sec('checklist flow');
    await setMode('checklist', id);
    const ch4 = await chat('評分');
    ok(ch4.d.operations[0].op === 'set_checklist', 'set_checklist op');
    ok(ch4.d.operations[0].old[0].score === null, 'old checklist score null initially');
    await j('/api/ai/apply', { method: 'POST', body: JSON.stringify({ operations: ch4.d.operations }) });
    u = await j('/api/units/' + id);
    ok(u.d.checklist_avg === 5 && u.d.checklist_count === 1, 'checklist score applied (avg 5)', u.d.checklist_avg + '/' + u.d.checklist_count);

    sec('invalid / unsafe ops rejected as whole batch');
    const before = (await j('/api/units')).d.length;
    await setMode('invalid', id);
    const bad1 = await chat('刪');
    ok(bad1.d.invalid === true && bad1.d.operations.length === 0, 'delete op rejected -> invalid, ops empty');
    await setMode('badfield', id);
    const bad2 = await chat('hack');
    ok(bad2.d.invalid === true, 'unknown field rejected');
    ok((await j('/api/units')).d.length === before, 'no units created/removed by invalid ops');

    sec('malformed + upstream errors');
    await setMode('malformed', id);
    const mf = await chat('x');
    ok(mf.s === 200 && /not json/.test(mf.d.message) && mf.d.operations.length === 0, 'malformed completion surfaced as text, no ops');
    await setMode('429', id);
    const rl = await chat('x');
    ok(rl.s === 429 && rl.d.error === 'ai_rate_limited', 'provider 429 -> 429 ai_rate_limited', JSON.stringify(rl.d));

    sec('bounds enforced server-side');
    const big = await chat('a'.repeat(2500));
    ok(big.s === 413, 'over-long message -> 413', String(big.s));
    await setMode('update', id);
    await j('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'cap check', max_tokens: 999999, model: 'evil-model' }) });
    const last = await mj('/__last');
    ok(last.d.capped === true, 'worker forces max_tokens=700 regardless of browser', JSON.stringify(last.d));
    ok(last.d.hasAuth === true, 'worker sends Bearer auth header');
    ok(last.d.model === 'qwen-plus', 'browser-supplied model ignored (qwen-plus used)', last.d.model);
  }

  console.log('\nRESULT[' + MODE + ']: ' + pass + ' passed, ' + fail + ' failed');
  if (fails.length) fails.forEach(f => console.log(' - ' + f));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
