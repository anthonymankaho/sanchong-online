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
| 資料庫 / Database | Cloudflare **D1**（SQLite）| 單位、檢查表評分、相片索引 |
| 相片 / Photos | Cloudflare **R2** | 壓縮後嘅 JPEG blob |

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
- 離線單檔案版（另一個 repo）：**104/104**

Covered: CRUD、檢查表 upsert／平均分、相片上傳／串流／cascade 刪除、路徑穿越防護、比較表計算、XSS、UI 全流程。

---

## ⚠️ 重要：完全公開 / Important: fully public

本應用**沒有任何登入或密碼** — 任何知道 URL 的人都可**讀取、修改、刪除**全部資料。呢係擁有者明確選擇嘅設定。

This app has **no login or password** — anyone with the URL can **read, modify, and delete** all data. This is the owner's explicit choice.

如想加保護，日後可加一個 Worker secret 做編輯密碼；目前刻意保持公開。
If protection is wanted later, an edit passcode via a Worker secret can be added; it is intentionally open today.

---

## 📄 授權 / License

[MIT](LICENSE) © 2026 Anthony Man
