-- Accumulating upserts for the per-table and per-croupier pattern tables, mirroring
-- upsert_pattern() from 002_create_functions.sql exactly (same hit/miss/accuracy semantics).

CREATE OR REPLACE FUNCTION upsert_table_pattern(
  p_table_name TEXT,
  p_starting_num INT,
  p_direction TEXT,
  p_landed_num INT,
  p_hit BOOLEAN
) RETURNS void AS $$
BEGIN
  INSERT INTO table_spin_patterns
    (table_name, starting_number, direction, landed_number, hit_count, miss_count, frequency, accuracy, last_updated)
  VALUES
    (
      p_table_name, p_starting_num, p_direction, p_landed_num,
      CASE WHEN p_hit THEN 1 ELSE 0 END,
      CASE WHEN p_hit THEN 0 ELSE 1 END,
      1,
      CASE WHEN p_hit THEN 100 ELSE 0 END,
      now()
    )
  ON CONFLICT (table_name, starting_number, direction, landed_number)
  DO UPDATE SET
    hit_count = table_spin_patterns.hit_count + (CASE WHEN p_hit THEN 1 ELSE 0 END),
    miss_count = table_spin_patterns.miss_count + (CASE WHEN NOT p_hit THEN 1 ELSE 0 END),
    frequency = table_spin_patterns.frequency + 1,
    accuracy = ROUND(
      ((table_spin_patterns.hit_count + (CASE WHEN p_hit THEN 1 ELSE 0 END))::DECIMAL /
       (table_spin_patterns.frequency + 1)) * 100,
      2
    ),
    last_updated = now();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION upsert_croupier_pattern(
  p_croupier_name TEXT,
  p_croupier_nickname TEXT,
  p_starting_num INT,
  p_direction TEXT,
  p_landed_num INT,
  p_hit BOOLEAN
) RETURNS void AS $$
BEGIN
  INSERT INTO croupier_spin_patterns
    (croupier_name, croupier_nickname, starting_number, direction, landed_number, hit_count, miss_count, frequency, accuracy, last_updated)
  VALUES
    (
      p_croupier_name, COALESCE(p_croupier_nickname, ''), p_starting_num, p_direction, p_landed_num,
      CASE WHEN p_hit THEN 1 ELSE 0 END,
      CASE WHEN p_hit THEN 0 ELSE 1 END,
      1,
      CASE WHEN p_hit THEN 100 ELSE 0 END,
      now()
    )
  ON CONFLICT (croupier_name, croupier_nickname, starting_number, direction, landed_number)
  DO UPDATE SET
    hit_count = croupier_spin_patterns.hit_count + (CASE WHEN p_hit THEN 1 ELSE 0 END),
    miss_count = croupier_spin_patterns.miss_count + (CASE WHEN NOT p_hit THEN 1 ELSE 0 END),
    frequency = croupier_spin_patterns.frequency + 1,
    accuracy = ROUND(
      ((croupier_spin_patterns.hit_count + (CASE WHEN p_hit THEN 1 ELSE 0 END))::DECIMAL /
       (croupier_spin_patterns.frequency + 1)) * 100,
      2
    ),
    last_updated = now();
END;
$$ LANGUAGE plpgsql;
