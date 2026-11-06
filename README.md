# 中山三鄉睇樓評分表 · 線上版 / Sanxiang Property Viewer (Online)

**Live / 線上:** https://sanchong-online.anthonym-354.workers.dev

一個部署喺 Cloudflare 嘅線上睇樓工具：單位評分、**67 項實地檢查表**（源自《買樓實地檢查及三盤比較表》）、同**多盤比較表**。

An online property-viewing tool on Cloudflare: unit scoring, a **67-item on-site inspection checklist** (from 《買樓實地檢查及三盤比較表》), and a **multi-property comparison table**.

---

## 🏗 架構 / Architecture

| 層 / Layer | 技術 / Tech | 用途 / Purpose |
|---|---|---|
| 前端 / Frontend | 靜態 SPA（`public/index.html` + `app.js`）| 手機優先 UI，四個 tab：列表／新增／檢查表／比較 |
| 後端 / Backend | Cloudflare **Workers**（`src/worker.js`）| JSON API + 相片串流 |
| 資料庫 / Database | Cloudflare **D1**（SQLite）| 單位、檢查表評分、相片索引、AI quota |
| 相片 / Photos | Cloudflare **R2** | 壓縮後嘅 JPEG blob |
| AI 助手 / AI assistant | **QwenCloud Token Plan**（`qwen3.7-plus`）| 🤖 分析＋propose 修改（fail-closed，需審查套用）|

零伺服器、零 npm runtime 依賴；`wrangler` 只用於部署。
No servers, no runtime npm dependencies; `wrangler` is deploy-only.

---

## 🚀 本地開發 / Local development

```bash
npm install                      # 只裝 wrangler / installs wrangler only
npx wrangler d1 execute sanchong-db --local --file=schema.sql   # 建本地表 / create local tables
npm run dev                      # http://127.0.0.1:8787 (or --port 8788)
```

##  部署 / Deploy

```bash
npx wrangler d1 execute sanchong-db --remote --file=schema.sql  # 一次性：建遠端表 / one-time: remote tables
npx wrangler r2 bucket create sanchong-photos                   # 一次性：建 bucket / one-time: bucket
npx wrangler deploy                                             # 部署 / deploy
```

> 首次使用 R2 需喺 Cloudflare Dashboard 啟用 R2（$0 計劃）。
> R2 must be enabled once in the Cloudflare dashboard ($0 plan).

---

## 🔌 API

| Method | Path | 說明 / Description |
|---|---|---|
| GET | `/api/schema` | 檢查表 schema（7 類別 67 項）＋評分標籤 |
| GET | `/api/units` | 所有單位（含相片清單＋檢查表摘要）|
| POST | `/api/units` | 建立單位（`estate` 必填）|
| GET | `/api/units/:id` | 單個單位（含 `photos`、`checklist`、`checklist_avg`）|
| PUT | `/api/units/:id` | 更新單位 |
| DELETE | `/api/units/:id` | 刪除單位（cascade 檢查表＋相片＋R2 blob）|
| POST | `/api/units/:id/photos` | 上傳相片 `{photos:[dataURL...]}` → R2 |
| DELETE | `/api/photos/:id` | 刪除單張相片 |
| PUT | `/api/units/:id/checklist` | 批次 upsert 檢查表評分 `{items:[{category,item,score}]}` |
| GET | `/api/compare` | 多盤比較（平均評分、每㎡叫價、估計總成本…）|
| GET | `/photos/<key>` | R2 相片串流 |
| GET | `/api/ai/quota` | AI 配置狀態＋token 配額（`configured`、`used/limit/remaining`、`refresh:false`）|
| POST | `/api/ai/chat` | AI 對話 `{message, history?}` → `{message, operations[], invalid, quota}` |
| POST | `/api/ai/apply` | 套用已審查嘅 ops `{operations[]}`（重驗簽名；過期整批 409）|

檢查表評分 `score` = 1–5（1=很差…5=優秀），`null` = 不適用／未評分（不計入平均）。
Checklist `score` = 1–5; `null` = N/A or unscored (excluded from the average).

---

## 🗄 資料模型 / Data model

- `units` — 樓盤基本資料＋價格＋總體評分（1–10）＋六項細分（JSON）＋交易風險文字欄
- `checklist(unit_id, category, item, score)` — `UNIQUE(unit_id, category, item)`，upsert 更新
- `photos(unit_id, r2_key)` — 刪除單位時 cascade 並同步刪 R2 blob

---

## ✅ 測試 / Tests

- **API：22/22** 通過（本地 dev ＋ 線上生產環境各跑一次）
- **UI：24/24** 通過（headless Edge，本地＋線上）
- **AI 後端：30/30** 通過（functional 26 ＋ quota-trip 2 ＋ no-key 2，`test-ai.js` + `test-mock.js`）
- 離線單檔案版（另一個 repo）：**104/104**

Covered: CRUD、檢查表 upsert／平均分、相片上傳／串流／cascade 刪除、路徑穿越防護、比較表計算、XSS、UI 全流程、AI fail-closed ops／簽名／過期 409／配額 402／無 key 503。

```bash
node test-mock.js 9998 &                 # contract mock upstream
node test-ai.js functional http://127.0.0.1:8789 http://127.0.0.1:9998
node test-ai.js trip     http://127.0.0.1:8789     # quota row pre-set high
node test-ai.js nokey    http://127.0.0.1:8792     # dev started without the secret
```

---

## 🤖 AI 助手 / AI assistant

- **Provider:** QwenCloud **Token Plan**（Singapore），endpoint `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1`，model `qwen3.7-plus`（見 `wrangler.toml [vars]`）。
- **Key:** Worker secret `DASHSCOPE_API_KEY`。啟用／更換：
  ```bash
  npx wrangler secret put DASHSCOPE_API_KEY --name sanchong-online
  ```
  （互動式 stdin 輸入；key 永遠唔入 repo／chat／log。 / Interactive stdin; the key never enters repo/chat/logs.)
- **Fail-closed:** AI 只可 propose `create_unit` / `update_unit` / `set_checklist`；每個 update 帶 sha256 簽名，過期或未知欄位**整批拒絕（409）**；未有明確 apply 絕不寫入。前端顯示舊→新 diff、逐項勾選＋確認、可 Discard／Undo。
- **Quota:** 5,000,000 tokens、cumulative、**唔自動刷新**；耗盡回 402 並停用助手。擁有人可手動重置（見 `SOP.md`）。
- **未配置時:** `/api/ai/quota` 回 `configured:false`、chat 回 503 — 屬安全預設，唔係壞咗。

> ⚠️ 你嘅 key 係 **Token Plan（`sk-sp-...`）** 類型：只對 Token Plan base URL 有效；
> `dashscope.aliyuncs.com`／`dashscope-intl.aliyuncs.com` 都會回 401。
> Your key is a **Token Plan (`sk-sp-...`)** type: it only works against the Token Plan
> base URL; the plain DashScope endpoints return 401.

---

## 📌 進度記錄 / Progress log

| 日期 / Date | 變更 / Change |
|---|---|
| 2026-11-06 | 初版上線：單位評分＋67 項檢查表＋多盤比較（Workers+D1+R2）|
| 2026-11-07 | 加入 🤖 AI 助手；修正 endpoint 去 QwenCloud Token Plan＋model `qwen3.7-plus`；**AI 啟用並驗證 200** |

---

## ⚠️ 重要：完全公開 / Important: fully public

本應用**沒有任何登入或密碼** — 任何知道 URL 的人都可**讀取、修改、刪除**全部資料。呢係擁有者明確選擇嘅設定。

This app has **no login or password** — anyone with the URL can **read, modify, and delete** all data. This is the owner's explicit choice.

如想加保護，日後可加一個 Worker secret 做編輯密碼；目前刻意保持公開。
If protection is wanted later, an edit passcode via a Worker secret can be added; it is intentionally open today.

---

## 📄 授權 / License

[MIT](LICENSE) © 2026 Anthony Man
