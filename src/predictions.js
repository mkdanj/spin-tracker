// Ranking logic for candidate landed numbers, shared by App.jsx's Layer 3 fetch.
// Pulled into its own file so App.jsx stays close to the original spec's structure.

const CONFIDENCE_RANK = { HIGH: 2, MEDIUM: 1, LOW: 0 }

export function confidenceOf(frequency) {
  if (frequency < 10) return 'LOW'
  if (frequency < 30) return 'MEDIUM'
  return 'HIGH'
}

// rows: raw rows from master_spin_patterns (hit_count, miss_count, frequency, accuracy, landed_number)
// Returns rows re-ranked by confidence tier, then accuracy, then frequency.
export function rankCandidates(rows) {
  return [...rows]
    .map((r) => ({ ...r, confidence: confidenceOf(r.frequency) }))
    .sort((a, b) => {
      const confDiff = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
      if (confDiff !== 0) return confDiff
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy
      return b.frequency - a.frequency
    })
}

// Chance baseline: expected hit rate if `count` numbers were picked at random out of 37.
export function baselineRate(count) {
  return count > 0 ? Number(((count / 37) * 100).toFixed(2)) : 0
}
