// 中山三鄉睇樓評分表 (online) — frontend
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  let units = [];
  let schema = null;
  let editingId = null;
  let tempPhotos = [];        // new dataURLs not yet uploaded
  let savedPhotos = [];       // {id,url} already on server for editingId
  let chkScores = {};         // "category|item" -> score|null
  let chkUnitId = null;

  const SCORE_FIELDS = ['loc','layout','decor','env','value','agent'];
  // 三鄉主要樓盤（預設選擇；用家仍可自由輸入其他名稱）
  const ESTATES = [
    '雅居樂花園','雅居樂新城','雅居樂萬象郡','雅居樂佰利山','雅居樂錦城',
    '雅居樂畔山中心城','雅居樂灣際壹號','碧桂園·天悅府','碧桂園·爵悅府','三鄉碧桂園',
    '華發觀山水','雲山雅墅','金沙萬象郡花園'
  ];
  const NUM_INPUTS = ['area_use','area_build','year_built','age_years','price','price_negotiated','price_original','mgmt_fee','reno_cost'];
  const TXT_INPUTS = ['estate','unit','rooms','baths','parking','floor','facing','hold_years','pros','cons','intent','note'];

  // ---------- helpers ----------
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._h);
    toast._h = setTimeout(() => t.classList.remove('show'), 2200);
  }
  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }
  function money(n) { return n ? '¥' + Number(n).toLocaleString('en-US') : '—'; }
  function badgeCls(v) { return v >= 7 ? 'b-high' : v >= 5 ? 'b-mid' : 'b-low'; }

  // ---------- tabs ----------
  function showTab(name) {
    $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    ['list','form','check','compare'].forEach(v => $('#view-' + v).classList.add('hidden'));
    $('#view-' + name).classList.remove('hidden');
    window.scrollTo(0, 0);
    if (name === 'list') loadUnits();
    if (name === 'check') initCheckTab();
    if (name === 'compare') loadCompare();
  }

  // ---------- list ----------
  async function loadUnits() {
    units = await api('/api/units');
    renderList();
  }
  function renderList() {
    const el = $('#unitList');
    if (!units.length) { el.innerHTML = '<div class="empty">🏡<br>暫無記錄<br>撳下方「＋新增」開始睇樓</div>'; return; }
    el.innerHTML = units.map(u => {
      const areaRef = (u.area_use > 0 ? u.area_use : u.area_build) || 0;
      const perSqm = areaRef && u.price ? Math.round(u.price / areaRef) : null;
      let tags = '';
      if (u.type) tags += `<span class="tag tag-blue">${esc(u.type)}</span>`;
      if (u.decor) tags += `<span class="tag tag-green">${esc(u.decor)}</span>`;
      if (areaRef) tags += `<span class="tag tag-gray">${esc(areaRef)}㎡</span>`;
      if (u.rooms) tags += `<span class="tag tag-gray">${esc(u.rooms)}</span>`;
      if (u.floor) tags += `<span class="tag tag-gray">${esc(u.floor)}樓</span>`;
      if (u.facing) tags += `<span class="tag tag-orange">朝${esc(u.facing)}</span>`;
      const photos = (u.photos || []).slice(0, 6).map(p => `<img src="${esc(p.url)}" loading="lazy" alt="">`).join('');
      const more = (u.photos || []).length > 6 ? `<div class="photo-more">+${u.photos.length - 6}</div>` : '';
      const avg = u.checklist_avg != null
        ? `<div class="avg-row">實地檢查平均 <b>${u.checklist_avg}</b> / 5（已評 ${u.checklist_count} 項）</div>`
        : `<div class="avg-row">實地檢查：未評分</div>`;
      return `<div class="card">
        <div class="card-head">
          <div style="flex:1;min-width:0">
            <div class="card-title">${esc(u.estate)}${u.unit ? ` <span style="font-weight:400;font-size:14px;color:#777">· ${esc(u.unit)}</span>` : ''}</div>
            <div class="tags">${tags || '<span class="tag tag-gray">未填詳細</span>'}</div>
          </div>
          <div class="badge ${badgeCls(u.overall)}">${u.overall || 0}</div>
        </div>
        <div class="price-row"><span class="price-main">${money(u.price)}</span>${perSqm ? `<span class="price-unit">@ ¥${perSqm.toLocaleString('en-US')}/㎡</span>` : ''}</div>
        ${avg}
        ${u.note ? `<div style="font-size:13px;color:#555;background:#fffde7;border-left:3px solid #ffd600;border-radius:6px;padding:6px 10px;margin:6px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📝 ${esc(u.note)}</div>` : ''}
        ${photos ? `<div class="photo-strip">${photos}${more}</div>` : ''}
        <div class="card-actions">
          <button class="btn btn-sm btn-outline" data-act="edit" data-id="${u.id}">✏️ 編輯</button>
          <button class="btn btn-sm btn-primary" data-act="goCheck" data-id="${u.id}">✅ 檢查表</button>
          <button class="btn btn-sm btn-danger" data-act="del" data-id="${u.id}">🗑</button>
        </div>
        <div class="card-time">更新：${esc((u.updated_at || '').slice(0, 16).replace('T', ' '))}</div>
      </div>`;
    }).join('');
  }

  // ---------- form ----------
  function initScoreWidgets() {
    let h = '';
    for (let i = 1; i <= 10; i++) h += `<div class="star-btn" data-v="${i}">${i}</div>`;
    $('#scoreGroup').innerHTML = h;
    $('#scoreGroup').addEventListener('click', e => {
      const b = e.target.closest('.star-btn'); if (!b) return;
      setOverall(+b.dataset.v);
    });
    const opts = '<option value="">—</option>' + [1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}">${n}</option>`).join('');
    SCORE_FIELDS.forEach(k => { $('#sc_' + k).innerHTML = opts; });
  }
  function setOverall(v) {
    $$('#scoreGroup .star-btn').forEach(b => b.classList.toggle('active', +b.dataset.v === v));
    $('#scoreGroup').dataset.score = String(v);
  }
  function getOverall() { return parseInt($('#scoreGroup').dataset.score || '0', 10); }

  function initEstatePick() {
    const sel = $('#f_estate_pick');
    sel.innerHTML = '<option value="">（選擇三鄉主要樓盤，或下方自訂）</option>' +
      ESTATES.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('') +
      '<option value="__custom__">✏️ 自訂…</option>';
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (v === '__custom__') { $('#f_estate').value = ''; $('#f_estate').focus(); }
      else if (v) { $('#f_estate').value = v; }
    });
    $('#f_estate').addEventListener('input', syncEstatePick);
  }
  function syncEstatePick() {
    const v = $('#f_estate').value.trim();
    $('#f_estate_pick').value = ESTATES.includes(v) ? v : '';
  }

  function resetForm() {
    editingId = null;
    $('#formTitle').textContent = '新增單位';
    TXT_INPUTS.forEach(k => { const el = $('#f_' + k); if (el) el.value = ''; });
    $('#f_estate_pick').value = '';
    NUM_INPUTS.forEach(k => { const el = $('#f_' + k); if (el) el.value = ''; });
    $('#f_type').value = '二手';
    $('#f_decor').value = '毛坯';
    SCORE_FIELDS.forEach(k => { $('#sc_' + k).value = ''; });
    setOverall(7);
    tempPhotos = []; savedPhotos = [];
    renderPhotoGrid();
    $('#f_photos').value = '';
  }
  function openForm(id) {
    resetForm();
    if (id != null) {
      const u = units.find(x => x.id === id);
      if (!u) return;
      editingId = id;
      $('#formTitle').textContent = '編輯單位';
      TXT_INPUTS.forEach(k => { const el = $('#f_' + k); if (el) el.value = u[k] || ''; });
      syncEstatePick();
      NUM_INPUTS.forEach(k => { const el = $('#f_' + k); if (el) el.value = u[k] ? String(u[k]) : ''; });
      $('#f_type').value = u.type || '二手';
      $('#f_decor').value = u.decor || '毛坯';
      const sc = safeJson(u.scores);
      SCORE_FIELDS.forEach(k => { $('#sc_' + k).value = sc[k] ? String(sc[k]) : ''; });
      setOverall(u.overall || 7);
      savedPhotos = (u.photos || []).slice();
      renderPhotoGrid();
    }
    showTab('form');
  }
  function safeJson(s) { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } }

  async function saveForm() {
    const estate = $('#f_estate').value.trim();
    if (!estate) { toast('請填寫樓盤名稱'); $('#f_estate').focus(); return; }
    const payload = { estate };
    TXT_INPUTS.forEach(k => { if (k !== 'estate') payload[k] = ($('#f_' + k).value || '').trim(); });
    NUM_INPUTS.forEach(k => { payload[k] = parseFloat($('#f_' + k).value) || 0; });
    payload.type = $('#f_type').value;
    payload.decor = $('#f_decor').value;
    payload.overall = getOverall();
    const sc = {};
    SCORE_FIELDS.forEach(k => { sc[k] = parseInt($('#sc_' + k).value, 10) || 0; });
    payload.scores = JSON.stringify(sc);

    try {
      let id = editingId;
      if (id == null) {
        const r = await api('/api/units', { method: 'POST', body: JSON.stringify(payload) });
        id = r.id;
      } else {
        await api('/api/units/' + id, { method: 'PUT', body: JSON.stringify(payload) });
      }
      if (tempPhotos.length) {
        await api(`/api/units/${id}/photos`, { method: 'POST', body: JSON.stringify({ photos: tempPhotos }) });
      }
      toast('已儲存');
      showTab('list');
    } catch (e) { toast('儲存失敗：' + e.message); }
  }

  // ---------- photos ----------
  function compress(file) {
    return new Promise(resolve => {
      const rd = new FileReader();
      rd.onerror = () => resolve(null);
      rd.onload = ev => {
        const img = new Image();
        img.onerror = () => resolve(null);
        img.onload = () => {
          let w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) return resolve(null);
          const long = Math.max(w, h);
          if (long > 800) { const r = 800 / long; w = Math.round(w * r); h = Math.round(h * r); }
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
          try { resolve(c.toDataURL('image/jpeg', 0.6)); } catch (e) { resolve(null); }
        };
        img.src = ev.target.result;
      };
      rd.readAsDataURL(file);
    });
  }
  async function onPhotoPick(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const room = 12 - (tempPhotos.length + savedPhotos.length);
    if (room <= 0) { toast('最多 12 張相'); return; }
    const use = files.slice(0, room);
    if (files.length > room) toast('最多 12 張，已取前 ' + room + ' 張');
    toast('壓縮中…');
    for (const f of use) {
      const d = await compress(f);
      if (d) tempPhotos.push(d);
    }
    renderPhotoGrid();
  }
  function renderPhotoGrid() {
    const el = $('#photoGrid');
    const saved = savedPhotos.map(p =>
      `<div class="photo-item"><img src="${esc(p.url)}" alt=""><button class="photo-del" data-del-saved="${p.id}">×</button></div>`).join('');
    const tmp = tempPhotos.map((d, i) =>
      `<div class="photo-item"><img src="${d}" alt=""><button class="photo-del" data-del-tmp="${i}">×</button></div>`).join('');
    el.innerHTML = saved + tmp || '<div style="font-size:13px;color:#bbb">尚未選擇照片</div>';
  }
  async function deleteSavedPhoto(id) {
    try { await api('/api/photos/' + id, { method: 'DELETE' }); savedPhotos = savedPhotos.filter(p => p.id !== id); renderPhotoGrid(); toast('已刪除相片'); }
    catch (e) { toast('刪除失敗：' + e.message); }
  }

  // ---------- checklist ----------
  async function initCheckTab() {
    if (!schema) schema = await api('/api/schema');
    if (!units.length) await loadUnits();
    const sel = $('#chkUnit');
    sel.innerHTML = units.length
      ? units.map(u => `<option value="${u.id}">${esc(u.estate)}${u.unit ? ' · ' + esc(u.unit) : ''}</option>`).join('')
      : '<option value="">（未有單位）</option>';
    if (chkUnitId == null && units.length) chkUnitId = units[0].id;
    if (chkUnitId != null) sel.value = String(chkUnitId);
    await loadChecklist();
  }
  async function loadChecklist() {
    chkScores = {};
    if (chkUnitId == null) { $('#chkBody').innerHTML = '<div class="empty">請先新增單位</div>'; return; }
    const u = await api('/api/units/' + chkUnitId);
    (u.checklist || []).forEach(c => { chkScores[c.category + '|' + c.item] = c.score; });
    renderChecklist();
  }
  function renderChecklist() {
    const body = $('#chkBody');
    body.innerHTML = schema.checklist.map(cat => `
      <div class="card">
        <div class="sec">${esc(cat.category)}</div>
        ${cat.items.map(it => {
          const key = cat.category + '|' + it;
          const cur = chkScores[key];
          return `<div class="chk-item">
            <div class="chk-name">${esc(it)}</div>
            <div class="score5">
              ${[1,2,3,4,5].map(n => `<button class="s5${cur === n ? ' active' : ''}" data-key="${esc(key)}" data-s="${n}">${n}</button>`).join('')}
              <button class="s5 na${cur == null ? ' active' : ''}" data-key="${esc(key)}" data-s="">—</button>
            </div>
          </div>`;
        }).join('')}
      </div>`).join('');
    updateChkProgress();
  }
  function updateChkProgress() {
    const all = schema.checklist.reduce((n, c) => n + c.items.length, 0);
    const scored = Object.values(chkScores).filter(v => v != null);
    const avg = scored.length ? (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(2) : '—';
    $('#chkProgress').innerHTML = `已評 <b>${scored.length}</b> / ${all} 項 · 平均 <b>${avg}</b> / 5`;
  }
  async function saveChecklist() {
    if (chkUnitId == null) { toast('請先選擇單位'); return; }
    const items = Object.entries(chkScores).map(([key, score]) => {
      const i = key.indexOf('|');
      return { category: key.slice(0, i), item: key.slice(i + 1), score };
    });
    try {
      const r = await api(`/api/units/${chkUnitId}/checklist`, { method: 'PUT', body: JSON.stringify({ items }) });
      toast('已儲存 ' + r.saved + ' 項');
      await loadUnits();
    } catch (e) { toast('儲存失敗：' + e.message); }
  }

  // ---------- compare ----------
  async function loadCompare() {
    const rows = await api('/api/compare');
    const wrap = $('#cmpWrap');
    if (!rows.length) { wrap.innerHTML = '<div class="empty">未有單位可比較</div>'; return; }
    const cols = rows.map(r => `<th>${esc(r.estate)}${r.unit ? '<br><small>' + esc(r.unit) + '</small>' : ''}</th>`).join('');
    function row(label, get, fmt, bestMode) {
      const vals = rows.map(get);
      let bestIdx = -1;
      if (bestMode) {
        const nums = vals.map((v, i) => ({ v, i })).filter(o => o.v != null && o.v > 0);
        if (nums.length) {
          bestIdx = bestMode === 'high'
            ? nums.reduce((a, b) => (b.v > a.v ? b : a)).i
            : nums.reduce((a, b) => (b.v < a.v ? b : a)).i;
        }
      }
      const cells = vals.map((v, i) => `<td class="${i === bestIdx ? 'best' : ''}">${v == null ? '—' : fmt(v)}</td>`).join('');
      return `<tr><td>${label}</td>${cells}</tr>`;
    }
    const f0 = v => Number(v).toLocaleString('en-US');
    wrap.innerHTML = `<table class="cmp"><thead><tr><th>比較項目</th>${cols}</tr></thead><tbody>
      ${row('實地檢查平均（/5）', r => r.checklist_avg, v => v, 'high')}
      ${row('已評分項目數', r => r.checklist_count, f0, null)}
      ${row('總體評分（/10）', r => r.overall || null, f0, 'high')}
      ${row('叫價', r => r.price || null, f0, 'low')}
      ${row('議價後價格', r => r.price_negotiated || null, f0, 'low')}
      ${row('實用面積 ㎡', r => r.area_use || null, v => v, null)}
      ${row('每平方米叫價', r => r.price_per_sqm, f0, 'low')}
      ${row('建築年份', r => r.year_built || null, f0, 'high')}
      ${row('當年一手售價', r => r.price_original || null, f0, null)}
      ${row('每月管理費', r => r.mgmt_fee || null, f0, 'low')}
      ${row('預計裝修維修費', r => r.reno_cost || null, f0, 'low')}
      ${row('估計總成本（叫價＋維修）', r => r.total_cost || null, f0, 'low')}
      ${row('最終意向', r => r.intent || null, v => esc(v), null)}
    </tbody></table>`;
  }

  // ---------- global events ----------
  document.addEventListener('click', async e => {
    const tab = e.target.closest('.tabbar button');
    if (tab) { if (tab.dataset.tab === 'form') openForm(null); else showTab(tab.dataset.tab); return; }

    const b = e.target.closest('[data-act]');
    if (b) {
      const act = b.dataset.act, id = b.dataset.id ? Number(b.dataset.id) : null;
      if (act === 'new') openForm(null);
      else if (act === 'cancel') showTab('list');
      else if (act === 'save') saveForm();
      else if (act === 'edit') openForm(id);
      else if (act === 'goCheck') { chkUnitId = id; showTab('check'); }
      else if (act === 'saveCheck') saveChecklist();
      else if (act === 'del') {
        const u = units.find(x => x.id === id);
        if (confirm('確定刪除「' + (u ? u.estate : '') + '」？連檢查表同相片都會刪除，無法復原。')) {
          try { await api('/api/units/' + id, { method: 'DELETE' }); toast('已刪除'); loadUnits(); }
          catch (er) { toast('刪除失敗：' + er.message); }
        }
      }
      return;
    }

    const s5 = e.target.closest('.s5');
    if (s5) {
      const key = s5.dataset.key;
      const v = s5.dataset.s === '' ? null : Number(s5.dataset.s);
      chkScores[key] = v;
      s5.parentElement.querySelectorAll('.s5').forEach(x => x.classList.remove('active'));
      s5.classList.add('active');
      updateChkProgress();
      return;
    }

    const dtmp = e.target.closest('[data-del-tmp]');
    if (dtmp) { tempPhotos.splice(Number(dtmp.dataset.delTmp), 1); renderPhotoGrid(); return; }
    const dsav = e.target.closest('[data-del-saved]');
    if (dsav) { deleteSavedPhoto(Number(dsav.dataset.delSaved)); return; }
  });

  $('#chkUnit').addEventListener('change', async e => { chkUnitId = Number(e.target.value) || null; await loadChecklist(); });
  $('#f_photos').addEventListener('change', onPhotoPick);

  // ===================== AI assistant =====================
  let aiHistory = [];
  let aiPending = [];        // annotated ops from last response
  let aiUndo = null;         // snapshot for undo
  let aiBusy = false;

  function aiOpen() {
    $('#aiModal').classList.remove('hidden');
    $('#aiInput').focus();
    loadAiQuota();
  }
  function aiClose() { $('#aiModal').classList.add('hidden'); }
  async function loadAiQuota() {
    try {
      const q = await api('/api/ai/quota');
      if (!q.configured) { $('#aiQuota').textContent = 'AI 未配置（伺服器未設 API key）'; return; }
      const rem = q.quota.remaining;
      $('#aiQuota').textContent = rem <= 0
        ? '配額已用盡 — AI 已停用（唔會自動刷新）'
        : '配額餘額 ' + rem.toLocaleString('en-US') + ' / ' + q.quota.limit.toLocaleString('en-US') + ' tokens（ cumulative，唔刷新）';
    } catch (e) { $('#aiQuota').textContent = ''; }
  }
  function aiMsg(role, text) {
    const d = document.createElement('div');
    d.className = 'ai-msg ' + role;
    d.textContent = text;                 // escaped: never innerHTML for model text
    $('#aiMsgs').appendChild(d);
    $('#aiMsgs').scrollTop = $('#aiMsgs').scrollHeight;
  }
  function fmtVal(v) { return (v === null || v === undefined || v === '') ? '—' : String(v); }

  function renderAiOps(ops) {
    aiPending = ops || [];
    const wrap = $('#aiOpsWrap');
    wrap.innerHTML = '';
    if (!aiPending.length) { $('#aiApplyRow').classList.add('hidden'); return; }
    aiPending.forEach((o, i) => {
      const box = document.createElement('div');
      box.className = 'ai-ops';
      let title = '', diffs = '';
      if (o.op === 'create_unit') {
        title = '➕ 建立單位：' + (o.fields.estate || '');
        diffs = Object.entries(o.fields).map(([k, v]) => `<div class="ai-diff">${esc(k)} → <span class="new">${esc(fmtVal(v))}</span></div>`).join('');
      } else if (o.op === 'update_unit') {
        const u = units.find(x => x.id === o.id);
        title = '✏️ 更新單位 #' + o.id + '：' + (u ? u.estate : '');
        diffs = Object.entries(o.fields).map(([k, v]) =>
          `<div class="ai-diff">${esc(k)}：<span class="old">${esc(fmtVal(o.old && o.old[k]))}</span> → <span class="new">${esc(fmtVal(v))}</span></div>`).join('');
      } else {
        const u = units.find(x => x.id === o.unit_id);
        title = '✅ 檢查表 #' + o.unit_id + '：' + (u ? u.estate : '');
        const oldMap = {};
        (o.old || []).forEach(x => { oldMap[x.category + '|' + x.item] = x.score; });
        diffs = o.items.map(it =>
          `<div class="ai-diff">${esc(it.item)}：<span class="old">${esc(fmtVal(oldMap[it.category + '|' + it.item]))}</span> → <span class="new">${esc(fmtVal(it.score))}</span></div>`).join('');
      }
      box.innerHTML = `<label class="ai-ops-head"><input type="checkbox" data-opidx="${i}" checked> ${esc(title)}</label>${diffs}`;
      wrap.appendChild(box);
    });
    $('#aiApplyRow').classList.remove('hidden');
    $('#aiUndo').classList.add('hidden');
  }

  async function aiSend() {
    if (aiBusy) return;
    const input = $('#aiInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    aiMsg('user', text);
    aiBusy = true;
    $('#aiSend').disabled = true;
    try {
      const r = await api('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message: text, history: aiHistory }) });
      aiMsg('bot', r.message || '（AI 冇返回訊息）');
      aiHistory.push({ role: 'user', content: text });
      aiHistory.push({ role: 'assistant', content: r.message || '' });
      if (aiHistory.length > 12) aiHistory = aiHistory.slice(-12);
      if (r.invalid) aiMsg('err', '（AI 返回嘅修改建議格式無效，已捨棄 — 資料未改動）');
      renderAiOps(r.operations);
      if (r.quota) {
        $('#aiQuota').textContent = r.quota.remaining <= 0
          ? '配額已用盡 — AI 已停用（唔會自動刷新）'
          : '配額餘額 ' + r.quota.remaining.toLocaleString('en-US') + ' / ' + r.quota.limit.toLocaleString('en-US') + ' tokens';
      }
    } catch (e) {
      const m = e.message;
      if (m === 'quota_exhausted') aiMsg('err', 'AI 配額已用盡（5,000,000 tokens，唔會自動刷新）。助手已停用。');
      else if (m === 'ai_not_configured') aiMsg('err', 'AI 未配置：伺服器未設 DASHSCOPE_API_KEY。');
      else if (m === 'prompt_too_large') aiMsg('err', '內容太長，請縮短訊息或清空對話。');
      else aiMsg('err', 'AI 錯誤：' + m);
    } finally {
      aiBusy = false;
      $('#aiSend').disabled = false;
      $('#aiInput').focus();
    }
  }

  async function snapshotFor(ops) {
    const snap = { units: [], checklists: [], created: [] };
    for (const o of ops) {
      if (o.op === 'update_unit') {
        snap.units.push({ id: o.id, fields: o.old });
      } else if (o.op === 'set_checklist') {
        snap.checklists.push({ unit_id: o.unit_id, items: o.old });
      }
    }
    return snap;
  }

  async function aiApply() {
    const checked = Array.from(document.querySelectorAll('#aiOpsWrap input[data-opidx]:checked'))
      .map(c => aiPending[Number(c.dataset.opidx)]).filter(Boolean);
    if (!checked.length) { toast('請至少勾選一項'); return; }
    if (!confirm('確認套用 ' + checked.length + ' 項修改？')) return;
    aiUndo = await snapshotFor(checked);
    try {
      const r = await api('/api/ai/apply', { method: 'POST', body: JSON.stringify({ operations: checked }) });
      (r.applied || []).forEach(a => { if (a.op === 'create_unit') aiUndo.created.push(a.id); });
      toast('已套用 ' + r.applied.length + ' 項');
      renderAiOps([]);
      $('#aiUndo').classList.remove('hidden');
      await loadUnits();
    } catch (e) {
      toast('套用失敗：' + e.message);
      aiMsg('err', '套用失敗：' + e.message + '（資料未改動）');
    }
  }

  async function aiUndoNow() {
    if (!aiUndo) return;
    try {
      for (const id of aiUndo.created) await api('/api/units/' + id, { method: 'DELETE' });
      for (const u of aiUndo.units) await api('/api/units/' + u.id, { method: 'PUT', body: JSON.stringify(u.fields) });
      for (const c of aiUndo.checklists) {
        await api('/api/units/' + c.unit_id + '/checklist', { method: 'PUT', body: JSON.stringify({ items: c.items }) });
      }
      aiUndo = null;
      $('#aiUndo').classList.add('hidden');
      toast('已還原');
      await loadUnits();
    } catch (e) { toast('還原失敗：' + e.message); }
  }

  $('#aiFab').addEventListener('click', aiOpen);
  $('#aiClose').addEventListener('click', aiClose);
  $('#aiModal').addEventListener('click', e => { if (e.target === $('#aiModal')) aiClose(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#aiModal').classList.contains('hidden')) aiClose(); });
  $('#aiSend').addEventListener('click', aiSend);
  $('#aiInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(); } });
  $('#aiApply').addEventListener('click', aiApply);
  $('#aiDiscard').addEventListener('click', () => { renderAiOps([]); toast('已棄置建議'); });
  $('#aiUndo').addEventListener('click', aiUndoNow);

  // ---------- boot ----------
  initScoreWidgets();
  initEstatePick();
  showTab('list');
})();
