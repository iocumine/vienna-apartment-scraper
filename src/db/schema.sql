CREATE TABLE IF NOT EXISTS listings (
  id            TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  miss_count    INTEGER NOT NULL DEFAULT 0,
  title         TEXT,
  url           TEXT,
  district      INTEGER,
  postcode      INTEGER,
  rooms         REAL,
  area_m2       REAL,
  price         REAL,
  price_per_m2  REAL,
  lat           REAL,
  lng           REAL,
  published_at  TEXT,
  raw_json      TEXT
);

CREATE INDEX IF NOT EXISTS idx_listings_district ON listings (district);
CREATE INDEX IF NOT EXISTS idx_listings_active ON listings (is_active);
CREATE INDEX IF NOT EXISTS idx_listings_first_seen ON listings (first_seen_at);

CREATE TABLE IF NOT EXISTS district_daily_stats (
  date              TEXT NOT NULL,
  district          INTEGER NOT NULL,
  avg_price_per_m2  REAL,
  median_price_per_m2 REAL,
  active_count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, district)
);

CREATE TABLE IF NOT EXISTS alerts_sent (
  listing_id TEXT NOT NULL,
  type       TEXT NOT NULL,
  sent_at    TEXT NOT NULL,
  PRIMARY KEY (listing_id, type)
);
