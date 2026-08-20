-- Layer 3: session-end review + suspect-spin tracking + per-table/per-croupier patterns.
--
-- American-wheel "00" is stored as the sentinel integer 37 everywhere a landed/starting
-- number is stored, so every number column can stay INTEGER. The app's wheel.js formats
-- 37 back to "00" for display.

-- ── Layer 1: croupier nickname + roulette type per session ────────────────────────────
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS croupier_nickname TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS roulette_type TEXT NOT NULL DEFAULT 'european'
  CHECK (roulette_type IN ('european', 'american'));

-- ── Layer 2: per-spin CLEAN / SUSPECT evaluation ───────────────────────────────────────
ALTER TABLE spins ADD COLUMN IF NOT EXISTS spin_status TEXT NOT NULL DEFAULT 'CLEAN'
  CHECK (spin_status IN ('CLEAN', 'SUSPECT_CROUPIER', 'SUSPECT_BALL'));
ALTER TABLE spins ADD COLUMN IF NOT EXISTS suspect_branch TEXT
  CHECK (suspect_branch IN ('CROUPIER', 'BALL'));
ALTER TABLE spins ADD COLUMN IF NOT EXISTS suspect_reason TEXT;
-- Whether this spin was approved for inclusion in pattern commits at session-end review.
ALTER TABLE spins ADD COLUMN IF NOT EXISTS approved BOOLEAN;
-- Snapshot of what was actually committed for this spin, set once review runs.
ALTER TABLE spins ADD COLUMN IF NOT EXISTS committed BOOLEAN NOT NULL DEFAULT false;

-- Widen existing CHECK constraints from 0-36 to 0-37 to allow the American "00" sentinel.
ALTER TABLE spins DROP CONSTRAINT IF EXISTS spins_starting_number_check;
ALTER TABLE spins ADD CONSTRAINT spins_starting_number_check
  CHECK (starting_number >= 0 AND starting_number <= 37);
ALTER TABLE spins DROP CONSTRAINT IF EXISTS spins_landed_number_check;
ALTER TABLE spins ADD CONSTRAINT spins_landed_number_check
  CHECK (landed_number >= 0 AND landed_number <= 37);

ALTER TABLE master_spin_patterns DROP CONSTRAINT IF EXISTS master_spin_patterns_starting_number_check;
ALTER TABLE master_spin_patterns ADD CONSTRAINT master_spin_patterns_starting_number_check
  CHECK (starting_number >= 0 AND starting_number <= 37);
ALTER TABLE master_spin_patterns DROP CONSTRAINT IF EXISTS master_spin_patterns_landed_number_check;
ALTER TABLE master_spin_patterns ADD CONSTRAINT master_spin_patterns_landed_number_check
  CHECK (landed_number >= 0 AND landed_number <= 37);

-- ── Per-table pattern table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS table_spin_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  starting_number INTEGER CHECK (starting_number >= 0 AND starting_number <= 37),
  direction TEXT CHECK (direction IN ('CW', 'ACW')),
  landed_number INTEGER CHECK (landed_number >= 0 AND landed_number <= 37),
  hit_count INTEGER DEFAULT 0,
  miss_count INTEGER DEFAULT 0,
  frequency INTEGER DEFAULT 0,
  accuracy DECIMAL(5, 2) DEFAULT 0,
  last_updated TIMESTAMP DEFAULT now(),
  UNIQUE (table_name, starting_number, direction, landed_number)
);
CREATE INDEX IF NOT EXISTS idx_table_patterns ON table_spin_patterns(table_name, starting_number, direction);

-- ── Per-croupier pattern table (name + nickname together identify a croupier) ─────────
CREATE TABLE IF NOT EXISTS croupier_spin_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  croupier_name TEXT NOT NULL,
  croupier_nickname TEXT NOT NULL DEFAULT '',
  starting_number INTEGER CHECK (starting_number >= 0 AND starting_number <= 37),
  direction TEXT CHECK (direction IN ('CW', 'ACW')),
  landed_number INTEGER CHECK (landed_number >= 0 AND landed_number <= 37),
  hit_count INTEGER DEFAULT 0,
  miss_count INTEGER DEFAULT 0,
  frequency INTEGER DEFAULT 0,
  accuracy DECIMAL(5, 2) DEFAULT 0,
  last_updated TIMESTAMP DEFAULT now(),
  UNIQUE (croupier_name, croupier_nickname, starting_number, direction, landed_number)
);
CREATE INDEX IF NOT EXISTS idx_croupier_patterns
  ON croupier_spin_patterns(croupier_name, croupier_nickname, starting_number, direction);

-- ── Jump events: logged whenever a CLEAN/approved spin classifies as JUMP ──────────────
CREATE TABLE IF NOT EXISTS jump_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  spin_id UUID REFERENCES spins(id),
  table_name TEXT NOT NULL,
  croupier_name TEXT NOT NULL,
  croupier_nickname TEXT,
  starting_number INTEGER,
  direction TEXT,
  landed_number INTEGER,
  predicted_numbers INTEGER[],
  jump_distance INTEGER,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jump_events_session ON jump_events(session_id);

-- ── Accident log: every SUSPECT_BALL spin, automatically, plus SUSPECT_CROUPIER
--    spins that were left unapproved ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accident_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  spin_id UUID REFERENCES spins(id),
  table_name TEXT NOT NULL,
  croupier_name TEXT NOT NULL,
  croupier_nickname TEXT,
  starting_number INTEGER,
  direction TEXT,
  landed_number INTEGER,
  spin_status TEXT,
  suspect_branch TEXT,
  suspect_reason TEXT,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accident_log_session ON accident_log(session_id);
