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

## Layer 3: session-end review (2026-08-20)

Added per the "Layer 3 Build Spec": a croupier nickname + roulette type (European/
American) field on Layer 1; a per-spin CLEAN/SUSPECT evaluation on Layer 2 (croupier
or ball branch, with reason dropdowns); and a new session-end review screen (Layer 3)
that replaces the old per-spin prediction modal entirely — the old modal
(`PREDICTION_THRESHOLD`/`fetchTracking`) was dead code that never actually rendered
because `setLayer('layer3')` was never called, so it wasn't a working feature to begin
with.

The review screen shows, for every recorded spin, ranked predictions from all three
tiers (`master_spin_patterns`, `table_spin_patterns`, `croupier_spin_patterns`),
classifies the actual result as HIT / NEAR MISS / JUMP / MISS, shows wheel
neighbours, and lets you approve or exclude suspect spins before committing. See
`migrations/003_layer3_schema.sql` and `004_layer3_functions.sql` for the schema,
and `src/wheel.js` for the wheel-order/classification logic.

Two judgment calls made where the spec was ambiguous (flagged here for correction if
wrong):
- **NEAR MISS vs JUMP** is defined by physical wheel-position distance from the
  canonical predicted set: 1 pocket away = NEAR MISS, 2 pockets away = JUMP, more
  than that = MISS.
- **American "00"** is stored as the sentinel integer `37` in every number column
  (so they can stay INTEGER); the UI always displays it back as "00".

## Known limitations carried over from the spec

- **Small-sample confidence.** Same caveat as before: predictions are ranked by a
  LOW/MEDIUM/HIGH confidence tier based on sample count (<10 / <30 / 30+), which is
  still thin for a 37-number wheel. The review screen shows a chance-baseline
  percentage next to the historical accuracy for comparison, but there's no
  significance test behind it.
