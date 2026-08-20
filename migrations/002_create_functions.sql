-- Function to upsert a pattern row and recalculate accuracy.
-- Called on EVERY tracked spin (hit or miss) by the app, so hit_count/miss_count/accuracy
-- actually accumulate over time. (A hit updates the row for the number that landed and was
-- predicted; a miss updates the row for the number that landed and was NOT predicted at the
-- time — over many spins this converges to a real hit rate for that triple.)
CREATE OR REPLACE FUNCTION upsert_pattern(
  p_starting_num INT,
  p_direction TEXT,
  p_landed_num INT,
  p_hit BOOLEAN
) RETURNS void AS $$
BEGIN
  INSERT INTO master_spin_patterns
    (starting_number, direction, landed_number, hit_count, miss_count, frequency, accuracy, last_updated)
  VALUES
    (
      p_starting_num, p_direction, p_landed_num,
      CASE WHEN p_hit THEN 1 ELSE 0 END,
      CASE WHEN p_hit THEN 0 ELSE 1 END,
      1,
      CASE WHEN p_hit THEN 100 ELSE 0 END,
      now()
    )
  ON CONFLICT (starting_number, direction, landed_number)
  DO UPDATE SET
    hit_count = master_spin_patterns.hit_count + (CASE WHEN p_hit THEN 1 ELSE 0 END),
    miss_count = master_spin_patterns.miss_count + (CASE WHEN NOT p_hit THEN 1 ELSE 0 END),
    frequency = master_spin_patterns.frequency + 1,
    accuracy = ROUND(
      ((master_spin_patterns.hit_count + (CASE WHEN p_hit THEN 1 ELSE 0 END))::DECIMAL /
       (master_spin_patterns.frequency + 1)) * 100,
      2
    ),
    last_updated = now();
END;
$$ LANGUAGE plpgsql;
