// 中山三鄉睇樓評分表 (online) — Cloudflare Worker
// Serves the JSON API, R2 photo blobs, and the static SPA from /public.

// Single source of truth for the on-site inspection scorecard (from 買樓實地檢查及三盤比較表.pdf).
// Each item is scored 1–5 (1=很差 2=較差 3=一般 4=良好 5=優秀); null = 不適用/未評分.
const CHECKLIST_SCHEMA = [
  { category: '小區環境', items: [
    '小區整體環境','園林／公園','泳池及保養','健身房／會所','小區整潔程度',
    '垃圾桶位置及清潔','垃圾房異味','保安／門禁','交通及生活配套','噪音／私隱' ] },
  { category: '大廈公共部分', items: [
    '外牆外觀及保養','外牆裂縫／滲水','大廈大堂','升降機數量及狀況','公共走廊整潔',
    '走廊採光／氣味','公共照明','大廈維修／特別徵費' ] },
  { category: '座向景觀', items: [
    '單位座向','日照／自然採光','通風情況','樓景','園景',
    '景觀開揚程度','是否狹窄／樓距','對望私隱','街道／交通噪音' ] },
  { category: '室內間隔裝修', items: [
    '室內整體保養','客廳面積','飯廳面積','主人房面積','睡房二面積','睡房三面積',
    '房間實用性／衣櫃','地板材質（木／磚）','地板磨損／空鼓','牆身油漆/背景板／牆紙',
    '牆身裂縫／發霉','窗戶開關／密封','窗框滲水','露台大小／狀況','露台封窗及合規',
    '天花板滲水／污漬','門鎖／室內門' ] },
  { category: '廚房及電器', items: [
    '廚房清潔／檯面','煮食爐類型及運作','抽油煙機','熱水爐類型／年期','雪櫃狀況',
    '冷氣機數量／製冷','燈飾／開關','插座／電箱','洗碗機／焗爐','洗衣設備' ] },
  { category: '浴室及水管', items: [
    '浴室整體潔淨程度','浴室異味／渠味','地漏／去水渠表面污漬','地漏排水速度','洗手盆去水',
    '淋浴間去水','馬桶沖水／漏水','瓷磚縫／霉菌','防水／滲漏痕跡','抽氣扇／通風','水壓及熱水穩定' ] },
  { category: '交易風險與決定', items: [
    '違規改建／露台封窗','產權／合約核查' ] },
];

const UNIT_FIELDS = [
  'estate','unit','type','area_use','area_build','rooms','baths','parking','floor','decor','facing',
  'price','price_negotiated','year_built','age_years','price_original','hold_years','mgmt_fee',
  'reno_cost','overall','scores','note','pros','cons','intent'
];
const NUM_FIELDS = new Set(['area_use','area_build','price','price_negotiated','year_built','age_years','price_original','mgmt_fee','reno_cost','overall']);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const err = (msg, status = 400) => json({ error: msg }, status);

function coerce(body) {
  const out = {};
  for (const f of UNIT_FIELDS) {
    if (!(f in body)) continue;
    let v = body[f];
    if (NUM_FIELDS.has(f)) { v = Number(v); v = Number.isFinite(v) ? v : 0; }
    else if (f === 'scores') { v = typeof v === 'string' ? v : JSON.stringify(v || {}); }
    else { v = String(v == null ? '' : v); }
    out[f] = v;
  }
  if (!out.estate || !String(out.estate).trim()) return null;
  return out;
}

function b64ToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function unitWithRelations(env, id) {
  const u = await env.DB.prepare('SELECT * FROM units WHERE id = ?').bind(id).first();
  if (!u) return null;
  const photos = await env.DB.prepare('SELECT id, r2_key, created_at FROM photos WHERE unit_id = ? ORDER BY id').bind(id).all();
  const checks = await env.DB.prepare('SELECT category, item, score FROM checklist WHERE unit_id = ?').bind(id).all();
  u.photos = photos.results.map(p => ({ id: p.id, url: '/photos/' + p.r2_key, created_at: p.created_at }));
  u.checklist = checks.results;
  const scored = checks.results.filter(c => c.score != null);
  u.checklist_avg = scored.length ? +(scored.reduce((s, c) => s + c.score, 0) / scored.length).toFixed(2) : null;
  u.checklist_count = scored.length;
  return u;
}

async function handleApi(env, url, request) {
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/schema' && method === 'GET') {
    return json({ checklist: CHECKLIST_SCHEMA, scoreLabels: { 1: '很差', 2: '較差', 3: '一般', 4: '良好', 5: '優秀' } });
  }

  if (path === '/api/units' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT id FROM units ORDER BY updated_at DESC, id DESC').all();
    const units = [];
    for (const r of rows.results) units.push(await unitWithRelations(env, r.id));
    return json(units);
  }

  if (path === '/api/units' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const data = coerce(body);
    if (!data) return err('estate is required');
    const now = new Date().toISOString();
    const cols = Object.keys(data);
    const sql = `INSERT INTO units (${cols.join(',')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(',')}, ?, ?)`;
    const res = await env.DB.prepare(sql).bind(...cols.map(c => data[c]), now, now).run();
    return json({ id: res.meta.last_row_id }, 201);
  }

  if (path === '/api/compare' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT id FROM units ORDER BY id').all();
    const out = [];
    for (const r of rows.results) {
      const u = await unitWithRelations(env, r.id);
      const areaRef = (u.area_use > 0 ? u.area_use : u.area_build) || 0;
      out.push({
        id: u.id, estate: u.estate, unit: u.unit,
        overall: u.overall,
        checklist_avg: u.checklist_avg, checklist_count: u.checklist_count,
        price: u.price, price_negotiated: u.price_negotiated,
        area_use: u.area_use, area_build: u.area_build,
        price_per_sqm: areaRef > 0 && u.price > 0 ? Math.round(u.price / areaRef) : null,
        year_built: u.year_built, price_original: u.price_original,
        mgmt_fee: u.mgmt_fee, reno_cost: u.reno_cost,
        total_cost: (u.price || 0) + (u.reno_cost || 0),
        intent: u.intent
      });
    }
    return json(out);
  }

  let m = path.match(/^\/api\/units\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (method === 'GET') {
      const u = await unitWithRelations(env, id);
      return u ? json(u) : err('not found', 404);
    }
    if (method === 'PUT') {
      const body = await request.json().catch(() => ({}));
      const data = coerce(body);
      if (!data) return err('estate is required');
      const cols = Object.keys(data);
      const sql = `UPDATE units SET ${cols.map(c => c + ' = ?').join(',')}, updated_at = ? WHERE id = ?`;
      const res = await env.DB.prepare(sql).bind(...cols.map(c => data[c]), new Date().toISOString(), id).run();
      if (!res.meta.changes) return err('not found', 404);
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const photos = await env.DB.prepare('SELECT r2_key FROM photos WHERE unit_id = ?').bind(id).all();
      for (const p of photos.results) { try { await env.PHOTOS.delete(p.r2_key); } catch (e) {} }
      const res = await env.DB.prepare('DELETE FROM units WHERE id = ?').bind(id).run();
      if (!res.meta.changes) return err('not found', 404);
      return json({ ok: true });
    }
  }

  m = path.match(/^\/api\/units\/(\d+)\/photos$/);
  if (m && method === 'POST') {
    const id = Number(m[1]);
    const exists = await env.DB.prepare('SELECT id FROM units WHERE id = ?').bind(id).first();
    if (!exists) return err('unit not found', 404);
    const body = await request.json().catch(() => ({}));
    const list = Array.isArray(body.photos) ? body.photos : [];
    const created = [];
    for (const dataUrl of list) {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) continue;
      const bytes = b64ToBytes(dataUrl);
      const key = `${id}/${crypto.randomUUID()}.jpg`;
      await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
      const ins = await env.DB.prepare('INSERT INTO photos (unit_id, r2_key, created_at) VALUES (?,?,?)')
        .bind(id, key, new Date().toISOString()).run();
      created.push({ id: ins.meta.last_row_id, url: '/photos/' + key });
    }
    return json(created, 201);
  }

  m = path.match(/^\/api\/photos\/(\d+)$/);
  if (m && method === 'DELETE') {
    const id = Number(m[1]);
    const row = await env.DB.prepare('SELECT r2_key FROM photos WHERE id = ?').bind(id).first();
    if (!row) return err('not found', 404);
    try { await env.PHOTOS.delete(row.r2_key); } catch (e) {}
    await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  m = path.match(/^\/api\/units\/(\d+)\/checklist$/);
  if (m && method === 'PUT') {
    const id = Number(m[1]);
    const exists = await env.DB.prepare('SELECT id FROM units WHERE id = ?').bind(id).first();
    if (!exists) return err('unit not found', 404);
    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [];
    const valid = new Set();
    for (const c of CHECKLIST_SCHEMA) for (const it of c.items) valid.add(c.category + '|' + it);
    const stmt = env.DB.prepare(
      'INSERT INTO checklist (unit_id, category, item, score) VALUES (?,?,?,?) ' +
      'ON CONFLICT(unit_id, category, item) DO UPDATE SET score = excluded.score'
    );
    const batch = [];
    for (const it of items) {
      if (!it || !valid.has((it.category || '') + '|' + (it.item || ''))) continue;
      let s = it.score;
      s = (s === null || s === undefined || s === '') ? null : Number(s);
      if (s !== null && (!Number.isInteger(s) || s < 1 || s > 5)) continue;
      batch.push(stmt.bind(id, it.category, it.item, s));
    }
    if (batch.length) await env.DB.batch(batch);
    await env.DB.prepare('UPDATE units SET updated_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();
    return json({ ok: true, saved: batch.length });
  }

  return err('not found', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(env, url, request);
      } catch (e) {
        return err('server error: ' + (e && e.message ? e.message : String(e)), 500);
      }
    }

    if (url.pathname.startsWith('/photos/')) {
      const key = decodeURIComponent(url.pathname.slice('/photos/'.length));
      if (!key || key.includes('..')) return err('bad key', 400);
      const obj = await env.PHOTOS.get(key);
      if (!obj) return err('not found', 404);
      return new Response(obj.body, {
        headers: {
          'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    return env.ASSETS.fetch(request);
  }
};