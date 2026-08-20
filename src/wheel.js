// Physical wheel layouts and neighbour/classification logic for Layer 3 review.
//
// American "00" is represented internally as the sentinel number 37 everywhere in this
// app (DB columns, prediction sets, etc.) so every number stays a plain INTEGER. Use
// formatNumber() any time a number is shown to a user.

export const EUROPEAN_WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]

// 00 is represented as 37 throughout the app.
export const AMERICAN_WHEEL_ORDER = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, 37, 27, 10, 25, 29, 12, 8,
  19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
]

export function wheelOrderFor(rouletteType) {
  return rouletteType === 'american' ? AMERICAN_WHEEL_ORDER : EUROPEAN_WHEEL_ORDER
}

export function isValidLandedNumber(num, rouletteType) {
  if (rouletteType === 'american') return num >= 0 && num <= 37
  return num >= 0 && num <= 36
}

export function formatNumber(num) {
  return num === 37 ? '00' : String(num)
}

export function parseNumberInput(raw) {
  const trimmed = String(raw).trim()
  if (trimmed === '00') return 37
  const n = parseInt(trimmed, 10)
  return Number.isNaN(n) ? null : n
}

// Physical (wheel-position) distance between two numbers, shortest way around the wheel.
export function wheelDistance(a, b, rouletteType) {
  const order = wheelOrderFor(rouletteType)
  const ia = order.indexOf(a)
  const ib = order.indexOf(b)
  if (ia === -1 || ib === -1) return Infinity
  const raw = Math.abs(ia - ib)
  return Math.min(raw, order.length - raw)
}

// Physically-adjacent pockets to `num`, `count` on each side, in wheel order.
export function getNeighbours(num, rouletteType, count = 2) {
  const order = wheelOrderFor(rouletteType)
  const idx = order.indexOf(num)
  if (idx === -1) return []
  const neighbours = []
  for (let i = 1; i <= count; i++) {
    neighbours.push(order[(idx - i + order.length) % order.length])
    neighbours.push(order[(idx + i) % order.length])
  }
  return neighbours
}

// Classify an actual landed number against a predicted top-N set.
// ASSUMPTION (flagged to the user — not explicit in the spec):
//   HIT       = landed number is in the predicted set
//   NEAR MISS = not predicted, but within 1 wheel position of a predicted number
//   JUMP      = not predicted, not a near miss, but within 2 wheel positions of a
//               predicted number (an unusually large physical jump from the model's
//               expectation — also logged to jump_events)
//   MISS      = anything else
export function classifyResult(landedNumber, predictedNumbers, rouletteType) {
  if (!predictedNumbers || predictedNumbers.length === 0) {
    return { result: 'MISS', distance: null }
  }
  if (predictedNumbers.includes(landedNumber)) {
    return { result: 'HIT', distance: 0 }
  }
  const distances = predictedNumbers.map((p) => wheelDistance(landedNumber, p, rouletteType))
  const minDistance = Math.min(...distances)
  if (minDistance === 1) return { result: 'NEAR MISS', distance: minDistance }
  if (minDistance === 2) return { result: 'JUMP', distance: minDistance }
  return { result: 'MISS', distance: minDistance }
}
