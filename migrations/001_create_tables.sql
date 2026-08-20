-- Sessions table
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id TEXT NOT NULL,
  croupier_id TEXT NOT NULL,
  session_start_time TIMESTAMP DEFAULT now(),
  session_end_time TIMESTAMP,
  total_spins INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

-- Spins table
CREATE TABLE spins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  table_id TEXT NOT NULL,
  croupier_id TEXT NOT NULL,
  spin_number INTEGER NOT NULL,
  starting_number INTEGER CHECK (starting_number >= 0 AND starting_number <= 36),
  direction TEXT CHECK (direction IN ('CW', 'ACW')),
  landed_number INTEGER CHECK (landed_number >= 0 AND landed_number <= 36),
  hit_or_miss TEXT,
  timestamp TIMESTAMP DEFAULT now(),
  created_at TIMESTAMP DEFAULT now()
);

-- Master spin patterns
CREATE TABLE master_spin_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  starting_number INTEGER CHECK (starting_number >= 0 AND starting_number <= 36),
  direction TEXT CHECK (direction IN ('CW', 'ACW')),
  landed_number INTEGER CHECK (landed_number >= 0 AND landed_number <= 36),
  hit_count INTEGER DEFAULT 0,
  miss_count INTEGER DEFAULT 0,
  frequency INTEGER DEFAULT 0,
  accuracy DECIMAL(5, 2) DEFAULT 0,
  last_updated TIMESTAMP DEFAULT now(),
  UNIQUE(starting_number, direction, landed_number)
);

-- Indexes
CREATE INDEX idx_sessions_table ON sessions(table_id);
CREATE INDEX idx_sessions_croupier ON sessions(croupier_id);
CREATE INDEX idx_spins_session ON spins(session_id);
CREATE INDEX idx_master_patterns ON master_spin_patterns(starting_number, direction);
