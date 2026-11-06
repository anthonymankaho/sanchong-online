-- 中山三鄉睇樓評分表 (online) — D1 schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS units (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    estate           TEXT    NOT NULL,
    unit             TEXT    DEFAULT '',
    type             TEXT    DEFAULT '二手',
    area_use         REAL    DEFAULT 0,      -- 實用面積 ㎡
    area_build       REAL    DEFAULT 0,      -- 建築面積 ㎡
    rooms            TEXT    DEFAULT '',
    baths            TEXT    DEFAULT '',
    parking          TEXT    DEFAULT '',
    floor            TEXT    DEFAULT '',
    decor            TEXT    DEFAULT '毛坯',
    facing           TEXT    DEFAULT '',
    price            REAL    DEFAULT 0,      -- 叫價
    price_negotiated REAL    DEFAULT 0,      -- 議價後價格
    year_built       INTEGER DEFAULT 0,
    age_years        INTEGER DEFAULT 0,
    price_original   REAL    DEFAULT 0,      -- 當年一手售價
    hold_years       TEXT    DEFAULT '',     -- 現業主持有／居住年期
    mgmt_fee         REAL    DEFAULT 0,      -- 每月管理費
    reno_cost        REAL    DEFAULT 0,      -- 預計裝修維修費
    overall          INTEGER DEFAULT 0,      -- 總體評分 1-10
    scores           TEXT    DEFAULT '{}',   -- JSON: 六項細分 1-10
    note             TEXT    DEFAULT '',
    pros             TEXT    DEFAULT '',     -- 主要優點
    cons             TEXT    DEFAULT '',     -- 主要缺點
    intent           TEXT    DEFAULT '',     -- 最終意向
    created_at       TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id  INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    category TEXT    NOT NULL,
    item     TEXT    NOT NULL,
    score    INTEGER,                        -- 1..5, NULL = 未評分/不適用
    UNIQUE (unit_id, category, item)
);
CREATE INDEX IF NOT EXISTS idx_checklist_unit ON checklist(unit_id);

CREATE TABLE IF NOT EXISTS photos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id    INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    r2_key     TEXT    NOT NULL UNIQUE,
    created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_unit ON photos(unit_id);

-- AI assistant token quota. Single row (id=1). Cumulative, NEVER auto-refreshes;
-- owner resets manually via D1. Counts tokens only, never prompt contents.
CREATE TABLE IF NOT EXISTS ai_quota (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    used_prompt     INTEGER NOT NULL DEFAULT 0,
    used_completion INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT    NOT NULL
);
