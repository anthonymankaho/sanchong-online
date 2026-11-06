# SOP — 中山三鄉睇樓評分表 · 線上版 / Operations Runbook

**Live:** https://sanchong-online.anthonym-354.workers.dev
**Repo:** `anthonymankaho/sanchong-online` · **Worker:** `sanchong-online` · **D1:** `sanchong-db` · **R2:** `sanchong-photos`

本 SOP 記錄日常營運步驟。所有命令喺 repo 根目錄執行。 / This runbook records day-to-day operational steps. Run all commands from the repo root.

---

## 1. 部署 / Deploy

```bash
npx wrangler deploy
```

- 靜態資源（`public/`）＋Worker 一齊部署。 / Deploys static assets (`public/`) + Worker together.
- 部署後驗證 / Verify after deploy:
  ```bash
  curl -s https://sanchong-online.anthonym-354.workers.dev/api/units
  curl -s https://sanchong-online.anthonym-354.workers.dev/api/ai/quota
  ```

## 2. Schema 變更 / Schema changes

改 `schema.sql` 後，**local 同 remote 都要套**： / After editing `schema.sql`, apply to **both local and remote**:

```bash
npx wrangler d1 execute sanchong-db --local  --file=schema.sql
npx wrangler d1 execute sanchong-db --remote --file=schema.sql
```

> `CREATE TABLE IF NOT EXISTS`／`IF NOT EXISTS` index 令重複執行安全。 / The `IF NOT EXISTS` clauses make re-runs safe.

## 3. API key（AI 助手）/ API key (AI assistant)

- Key 存做 **Worker secret**，永遠唔入 repo／chat／log。 / Stored as a **Worker secret**; never in repo/chat/logs.
- 設定／更換 / Set or rotate:
  ```bash
  npx wrangler secret put DASHSCOPE_API_KEY --name sanchong-online
  ```
  （互動式 stdin；輸入唔顯示。 / Interactive stdin; input is hidden.)
- **Key 類型注意 / Key-type caveat:** 擁有人嘅 key 係 QwenCloud **Token Plan（`sk-sp-...`）**，只對 Token Plan base URL 有效。Endpoint 同 model 喺 `wrangler.toml [vars]`：
  `QWEN_BASE_URL=https://token-plan.maas.qwencloudapi.com/compatible-mode/v1`、`QWEN_MODEL=qwen3.7-plus`。
  The owner's key is a QwenCloud **Token Plan (`sk-sp-...`)** key, valid only against the Token Plan base URL. Endpoint and model live in `wrangler.toml [vars]`.
- 驗證 / Verify: `curl -s .../api/ai/quota` 應回 `configured:true`；chat 應回 200。 / should return `configured:true`; chat should return 200.

## 4. AI quota 重置 / AI quota reset

Quota 係 **cumulative、唔自動刷新**（5,000,000 tokens）。耗盡時 chat 回 402。擁有人手動重置： / The quota is **cumulative and never auto-refreshes** (5,000,000 tokens). When spent, chat returns 402. Owner resets manually:

```bash
npx wrangler d1 execute sanchong-db --remote --command "UPDATE ai_quota SET used_prompt=0, used_completion=0, updated_at='manual-reset' WHERE id=1"
```

查看用量 / Check usage: `GET /api/ai/quota`。

## 5. 相片清理 / Photo cleanup

刪除單位會自動 cascade 刪 R2 blob。如需手動清孤兒物件： / Deleting a unit auto-cascades R2 blobs. To clear orphans manually:

```bash
npx wrangler r2 object list sanchong-photos      # 檢視 / inspect
npx wrangler r2 object delete sanchong-photos <key>
```

## 6. 備份／還原資料 / Backup / restore data

- 備份 / Backup: `GET /api/units` → 存 JSON（含 checklist；相片需另存 `/photos/<key>`）。 / save JSON (includes checklist; photos saved separately via `/photos/<key>`).
- 還原 / Restore: 逐筆 `POST /api/units`＋`PUT .../checklist`＋`POST .../photos`。 / per-unit POST/PUT as above.

## 7. 回滾 / Rollback

```bash
git log --oneline            # 搵返上一個好 commit / find last good commit
git revert <sha>             # 或 checkout 舊 commit / or check out old commit
npx wrangler deploy
```

Workers 亦支援即時回滾 / Workers also supports instant rollback:
```bash
npx wrangler rollback
```

## 8. 測試 / Testing

```bash
node test-mock.js 9998 &                  # contract mock upstream
# dev with key (uses .dev.vars) on 8789, dev without key on 8792:
npx wrangler dev --port 8789 --persist-to "%TEMP%\wdev-big"
npx wrangler dev --port 8792 --persist-to "%TEMP%\wdev-nokey2"   # rename .dev.vars away first
node test-ai.js functional http://127.0.0.1:8789 http://127.0.0.1:9998
node test-ai.js trip     http://127.0.0.1:8789
node test-ai.js nokey    http://127.0.0.1:8792
```

- `.dev.vars` 只用於本地 dev（已被 `.gitignore` 忽略）；生產用 Worker secret。 / `.dev.vars` is local-dev only (gitignored); production uses the Worker secret.
- 每個 dev instance 用獨立 `--persist-to` 目錄，避免 D1 衝突。 / Each dev instance uses its own `--persist-to` dir to avoid D1 clashes.

---

## 9. 故障排除 / Troubleshooting

| 症狀 / Symptom | 原因 / Cause | 處理 / Fix |
|---|---|---|
| chat 503 `ai_not_configured` | 未設 secret | 跑 §3 `secret put` |
| chat 502 `ai_provider_auth` | key 無效／類型錯（`sk-sp-` 對錯 endpoint）| 確認用 Token Plan base URL；重新 put key |
| chat 402 `quota_exhausted` | 配額耗盡（fail-closed）| §4 重置，或等擁有人決定 |
| apply 409 | 預覽過期（資料喺 propose 後被改）| 重新問 AI 生成新預覽再套用 |
| deploy 報 R2 `code:10042` | 帳戶未啟用 R2 | Dashboard 啟用 R2（$0 計劃）|
| Worker 504 但 curl upstream 正常 | workerd 唔支援 `redirect:'error'` | 保持 `redirect:'manual'`＋手動拒 3xx |
| `wrangler: command not found` | 未全局安裝 | 用 `npx wrangler ...` |
| `Required Worker name missing` | 唔喺 repo 目錄 | 加 `--name sanchong-online` 或 cd 入 repo |

---

## 10. 安全邊界 / Security boundaries

- **完全公開、無登入** — 任何知道 URL 的人可讀／改／刪。擁有人明確選擇。 / **Fully public, no login** — anyone with the URL can read/edit/delete. Owner's explicit choice.
- AI **不能**自行改 DB：ops 需 schema 校驗＋sha256 簽名＋明確 apply；過期／越權整批拒絕。 / The AI **cannot** mutate the DB on its own: ops need schema validation + sha256 sig + explicit apply; stale/out-of-scope rejects the whole batch.
- 瀏覽器傳嘅 model／limits 一律忽略；`max_tokens` 由 Worker 強制。 / Browser-supplied model/limits are ignored; `max_tokens` is forced by the Worker.

---

_Last updated: 2026-11-07_
