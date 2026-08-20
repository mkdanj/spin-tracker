# Spin Tracking Module

Standalone React (JSX) + Vite + Supabase app implementing the 3-layer spec:
session setup, plain spin entry for spins 1–10, then a tracking modal from spin 11
onward that shows a real prediction (queried from `master_spin_patterns`) and
records HIT/MISS against it.

## Setup

1. **Run the two SQL files** in your Supabase project's SQL Editor, in order:
   `migrations/001_create_tables.sql`, then `migrations/002_create_functions.sql`.
2. **Environment variables**: `cp .env.example .env` and fill in `VITE_SUPABASE_URL`
   / `VITE_SUPABASE_ANON_KEY` from your Supabase project settings.
3. **Install & run**: `npm install && npm run dev`, then visit `http://localhost:5173`.
4. **Row Level Security**: none is set up (matches the solo-testing scope). Anyone
   with the anon key can read/write every table — fine for now, add RLS before any
   wider rollout.

## What changed from the original draft spec, and why

The version of this spec you pasted had `App.jsx`'s Layer 3 (`fetchTracking`)
returning hardcoded values (`[5, 12, 16, 35, 36]`, `78.9%`, `45 hits` — the same
numbers from the original wireframe mockup) instead of querying the database. You
asked for the real algorithm to be wired up instead, which surfaced three more bugs
in the original draft that needed fixing along the way — noting them here rather
than silently changing behavior:

1. **Layer 3's Confirm never saved the spin.** The draft ran an `UPDATE` on
   `spins WHERE spin_number = spinNumber + 1`, but no row with that spin number had
   ever been `INSERT`ed — every spin from #11 onward would have silently gone
   unrecorded. Fixed by having Layer 3 `INSERT` the spin it's confirming.
2. **Layer 3 never advanced spin state.** After confirming, the draft reset straight
   to Layer 2 without updating `spinNumber`, `startingNumber`, or `direction` — the
   next Layer 2 view would have shown stale values and the spin counter would have
   desynced from what was actually in the database. Fixed by advancing state the
   same way Layer 2 does.
3. **The pattern table update only ran on HIT, via a flat (non-accumulating)
   `.upsert()`** that set `hit_count: 1, miss_count: 0` literally — repeated hits on
   the same triple would have overwritten the count back to 1 instead of
   accumulating, and misses were never recorded at all (so `accuracy` would drift
   toward 100% the same way flagged for the earlier build). The SQL migration
   already defined a proper accumulating `upsert_pattern()` RPC function for this —
   it just wasn't being called. Fixed by calling it on every tracked spin, hit or
   miss.
4. **The direction `<select>` had no `onChange` handler**, so on spin 1 the
   CW/ACW dropdown couldn't actually be changed by the user. Fixed.

## Known limitations carried over from the spec

- **Small-sample confidence.** Same caveat as before: predictions are ranked by a
  LOW/MEDIUM/HIGH confidence tier based on sample count (<10 / <30 / 30+), which is
  still thin for a 37-number wheel. The modal shows a chance-baseline percentage
  next to the historical accuracy for comparison, but there's no significance test
  behind it.
- **No table/croupier-specific patterns in this schema.** This version's migration
  only creates `master_spin_patterns` (no `table_spin_patterns` /
  `croupier_spin_patterns` / `jump_events`), per what was specified this time —
  predictions here are global across all tables and croupiers, not split out. The
  earlier TypeScript build (if you still have it) does track those separately.
