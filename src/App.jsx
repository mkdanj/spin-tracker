import { useState } from 'react'
import { supabase } from './supabaseClient'
import { rankCandidates, baselineRate, confidenceOf } from './predictions'
import {
  formatNumber,
  parseNumberInput,
  isValidLandedNumber,
  getNeighbours,
  classifyResult,
} from './wheel'
import './App.css'

const CROUPIER_REASONS = [
  'Slow dial speed',
  'Fast dial speed',
  'Random start',
  'Distracted',
  'Inconsistent technique',
  'External interruption',
]
const BALL_REASONS = [
  'Ball hit diamond',
  'Ball circled extra rounds',
  'Ball bounced',
  'Ball spun unusually',
  'Other',
]

// Next-session prediction hierarchy thresholds (from the spec).
const CROUPIER_TRUST_THRESHOLD = 30
const TABLE_TRUST_THRESHOLD = 20

export default function App() {
  const [layer, setLayer] = useState('layer1') // layer1, layer2, layer3

  // Layer 1 fields
  const [tableName, setTableName] = useState('')
  const [croupierName, setCroupierName] = useState('')
  const [croupierNickname, setCroupierNickname] = useState('')
  const [rouletteType, setRouletteType] = useState('european')
  const [sessionId, setSessionId] = useState(null)

  // Layer 2 fields
  const [spinNumber, setSpinNumber] = useState(0)
  const [startingNumber, setStartingNumber] = useState('')
  const [direction, setDirection] = useState('CW')
  const [landedNumber, setLandedNumber] = useState('')
  const [spinStatus, setSpinStatus] = useState('CLEAN') // CLEAN | SUSPECT_CROUPIER | SUSPECT_BALL
  const [suspectReason, setSuspectReason] = useState('')
  const [suspectReasonOther, setSuspectReasonOther] = useState('')
  const [spinHistory, setSpinHistory] = useState([])
  const [endingSession, setEndingSession] = useState(false)

  // Layer 3 fields
  const [reviewSpins, setReviewSpins] = useState([])
  const [committing, setCommitting] = useState(false)
  const [commitSummary, setCommitSummary] = useState(null)

  // ── LAYER 1: Start Session ─────────────────────────────────────────────────────────
  const handleStartSession = async () => {
    if (!tableName.trim() || !croupierName.trim()) {
      alert('Enter table name and croupier name')
      return
    }

    const { data, error } = await supabase
      .from('sessions')
      .insert([
        {
          table_id: tableName.trim(),
          croupier_id: croupierName.trim(),
          croupier_nickname: croupierNickname.trim() || null,
          roulette_type: rouletteType,
        },
      ])
      .select()

    if (error) {
      console.error('Error creating session:', error)
      alert('Failed to start session')
      return
    }

    setSessionId(data[0].id)
    setSpinNumber(0)
    setSpinHistory([])
    setLayer('layer2')
  }

  // ── LAYER 2: Record Spin ───────────────────────────────────────────────────────────
  const resetSpinInputs = (nextStarting, nextDirection) => {
    setStartingNumber(nextStarting)
    setDirection(nextDirection)
    setLandedNumber('')
    setSpinStatus('CLEAN')
    setSuspectReason('')
    setSuspectReasonOther('')
  }

  const handleRecordSpin = async () => {
    if (spinNumber === 0) {
      const startNum = parseNumberInput(startingNumber)
      if (startingNumber === '' || startNum === null || !isValidLandedNumber(startNum, rouletteType)) {
        alert(rouletteType === 'american' ? 'Enter starting number (0-36 or 00)' : 'Enter starting number (0-36)')
        return
      }
    }

    const landedNum = parseNumberInput(landedNumber)
    if (landedNumber === '' || landedNum === null || !isValidLandedNumber(landedNum, rouletteType)) {
      alert(rouletteType === 'american' ? 'Enter landed number (0-36 or 00)' : 'Enter landed number (0-36)')
      return
    }

    let branch = null
    let reason = null
    if (spinStatus === 'SUSPECT_CROUPIER') {
      if (!suspectReason) {
        alert('Select a croupier suspect reason')
        return
      }
      branch = 'CROUPIER'
      reason = suspectReason
    } else if (spinStatus === 'SUSPECT_BALL') {
      if (!suspectReason) {
        alert('Select a ball suspect reason')
        return
      }
      if (suspectReason === 'Other' && !suspectReasonOther.trim()) {
        alert('Describe the ball suspect reason')
        return
      }
      branch = 'BALL'
      reason = suspectReason === 'Other' ? suspectReasonOther.trim() : suspectReason
    }

    const newSpinNum = spinNumber + 1
    const startNum = parseNumberInput(startingNumber)

    const { error } = await supabase.from('spins').insert([
      {
        session_id: sessionId,
        table_id: tableName,
        croupier_id: croupierName,
        spin_number: newSpinNum,
        starting_number: startNum,
        direction: direction,
        landed_number: landedNum,
        spin_status: spinStatus,
        suspect_branch: branch,
        suspect_reason: reason,
        committed: false,
      },
    ])

    if (error) {
      console.error('Error recording spin:', error)
      alert('Failed to save spin')
      return
    }

    setSpinHistory([
      {
        spinNum: newSpinNum,
        starting: formatNumber(startNum),
        direction,
        landed: formatNumber(landedNum),
        spinStatus,
      },
      ...spinHistory,
    ])

    setSpinNumber(newSpinNum)
    resetSpinInputs(landedNum.toString(), direction === 'CW' ? 'ACW' : 'CW')
  }

  // ── Fetch a single tier's ranked prediction for (startNum, dir) ───────────────────
  const fetchTier = async (table, filters, startNum, dir) => {
    let query = supabase.from(table).select('*').eq('starting_number', startNum).eq('direction', dir)
    Object.entries(filters).forEach(([col, val]) => {
      query = query.eq(col, val)
    })
    const { data, error } = await query
    if (error) {
      console.error(`Error fetching ${table}:`, error)
      return { numbers: [], accuracy: 0, samples: 0, confidence: 'LOW', baseline: 0 }
    }
    const ranked = rankCandidates(data || [])
    const top5 = ranked.slice(0, 5)
    const samples = (data || []).reduce((sum, r) => sum + (r.frequency || 0), 0)
    return {
      numbers: top5.map((r) => r.landed_number),
      accuracy: top5[0]?.accuracy ?? 0,
      samples,
      confidence: confidenceOf(samples),
      baseline: baselineRate(top5.length),
    }
  }

  // ── LAYER 2 → LAYER 3: End Session, build the review screen ───────────────────────
  const handleEndSession = async () => {
    setEndingSession(true)
    try {
      const { data: spins, error } = await supabase
        .from('spins')
        .select('*')
        .eq('session_id', sessionId)
        .eq('committed', false)
        .order('spin_number', { ascending: true })

      if (error) {
        console.error('Error loading spins for review:', error)
        alert('Failed to load session spins')
        return
      }

      const built = []
      for (const spin of spins || []) {
        const master = await fetchTier('master_spin_patterns', {}, spin.starting_number, spin.direction)
        const table = await fetchTier(
          'table_spin_patterns',
          { table_name: tableName },
          spin.starting_number,
          spin.direction
        )
        const croupier = await fetchTier(
          'croupier_spin_patterns',
          { croupier_name: croupierName, croupier_nickname: croupierNickname.trim() || '' },
          spin.starting_number,
          spin.direction
        )

        let canonicalTier = 'MASTER'
        let canonicalSet = master.numbers
        if (croupier.samples > CROUPIER_TRUST_THRESHOLD) {
          canonicalTier = 'CROUPIER'
          canonicalSet = croupier.numbers
        } else if (table.samples > TABLE_TRUST_THRESHOLD) {
          canonicalTier = 'TABLE'
          canonicalSet = table.numbers
        }

        const { result, distance } = classifyResult(spin.landed_number, canonicalSet, rouletteType)
        const neighbours = getNeighbours(spin.landed_number, rouletteType, 2)

        // Default checkbox states per spec.
        let defaultApproved = true
        if (spin.spin_status === 'SUSPECT_CROUPIER') defaultApproved = false
        if (spin.spin_status === 'SUSPECT_BALL') defaultApproved = false // no checkbox, always excluded

        built.push({
          ...spin,
          master,
          table,
          croupier,
          canonicalTier,
          canonicalSet,
          result,
          distance,
          neighbours,
          approved: defaultApproved,
        })
      }

      setReviewSpins(built)
      setCommitSummary(null)
      setLayer('layer3')
    } finally {
      setEndingSession(false)
    }
  }

  const toggleApproval = (spinId) => {
    setReviewSpins((prev) =>
      prev.map((s) => (s.id === spinId && s.spin_status !== 'SUSPECT_BALL' ? { ...s, approved: !s.approved } : s))
    )
  }

  // ── LAYER 3: Commit & End Session ──────────────────────────────────────────────────
  const handleCommit = async () => {
    setCommitting(true)
    const summary = { patternWrites: 0, accidentsLogged: 0, jumpsLogged: 0, approvedCount: 0 }
    try {
      for (const spin of reviewSpins) {
        const isClean = spin.spin_status === 'CLEAN'
        const isSuspectCroupier = spin.spin_status === 'SUSPECT_CROUPIER'
        const isSuspectBall = spin.spin_status === 'SUSPECT_BALL'
        const approved = !isSuspectBall && spin.approved

        if (approved) summary.approvedCount += 1

        if (isSuspectBall) {
          // Automatic: accident_log only, never pattern tables.
          await supabase.from('accident_log').insert([
            {
              session_id: sessionId,
              spin_id: spin.id,
              table_name: tableName,
              croupier_name: croupierName,
              croupier_nickname: croupierNickname.trim() || null,
              starting_number: spin.starting_number,
              direction: spin.direction,
              landed_number: spin.landed_number,
              spin_status: spin.spin_status,
              suspect_branch: spin.suspect_branch,
              suspect_reason: spin.suspect_reason,
            },
          ])
          summary.accidentsLogged += 1
        } else if (isClean && approved) {
          // All three pattern tables, each scored against its own tier's prior top-5.
          const masterHit = spin.master.numbers.includes(spin.landed_number)
          const tableHit = spin.table.numbers.includes(spin.landed_number)
          const croupierHit = spin.croupier.numbers.includes(spin.landed_number)

          await supabase.rpc('upsert_pattern', {
            p_starting_num: spin.starting_number,
            p_direction: spin.direction,
            p_landed_num: spin.landed_number,
            p_hit: masterHit,
          })
          await supabase.rpc('upsert_table_pattern', {
            p_table_name: tableName,
            p_starting_num: spin.starting_number,
            p_direction: spin.direction,
            p_landed_num: spin.landed_number,
            p_hit: tableHit,
          })
          await supabase.rpc('upsert_croupier_pattern', {
            p_croupier_name: croupierName,
            p_croupier_nickname: croupierNickname.trim() || '',
            p_starting_num: spin.starting_number,
            p_direction: spin.direction,
            p_landed_num: spin.landed_number,
            p_hit: croupierHit,
          })
          summary.patternWrites += 3
        } else if (isSuspectCroupier && approved) {
          // Checked override: croupier_spin_patterns only.
          const croupierHit = spin.croupier.numbers.includes(spin.landed_number)
          await supabase.rpc('upsert_croupier_pattern', {
            p_croupier_name: croupierName,
            p_croupier_nickname: croupierNickname.trim() || '',
            p_starting_num: spin.starting_number,
            p_direction: spin.direction,
            p_landed_num: spin.landed_number,
            p_hit: croupierHit,
          })
          summary.patternWrites += 1
        } else {
          // SUSPECT_CROUPIER left unapproved: excluded from pattern tables, logged instead.
          await supabase.from('accident_log').insert([
            {
              session_id: sessionId,
              spin_id: spin.id,
              table_name: tableName,
              croupier_name: croupierName,
              croupier_nickname: croupierNickname.trim() || null,
              starting_number: spin.starting_number,
              direction: spin.direction,
              landed_number: spin.landed_number,
              spin_status: spin.spin_status,
              suspect_branch: spin.suspect_branch,
              suspect_reason: spin.suspect_reason,
            },
          ])
          summary.accidentsLogged += 1
        }

        // Jump events: logged for CLEAN/SUSPECT_CROUPIER spins that classified as JUMP
        // (SUSPECT_BALL anomalies are already captured in accident_log).
        if (spin.result === 'JUMP' && !isSuspectBall) {
          await supabase.from('jump_events').insert([
            {
              session_id: sessionId,
              spin_id: spin.id,
              table_name: tableName,
              croupier_name: croupierName,
              croupier_nickname: croupierNickname.trim() || null,
              starting_number: spin.starting_number,
              direction: spin.direction,
              landed_number: spin.landed_number,
              predicted_numbers: spin.canonicalSet,
              jump_distance: spin.distance,
            },
          ])
          summary.jumpsLogged += 1
        }

        await supabase
          .from('spins')
          .update({ approved, committed: true })
          .eq('id', spin.id)
      }

      await supabase
        .from('sessions')
        .update({ total_spins: summary.approvedCount, session_end_time: new Date().toISOString() })
        .eq('id', sessionId)

      setCommitSummary(summary)
    } catch (err) {
      console.error('Error committing session:', err)
      alert('Failed to fully commit session — check console for details')
    } finally {
      setCommitting(false)
    }
  }

  const handleStartNewSession = () => {
    setSessionId(null)
    setTableName('')
    setCroupierName('')
    setCroupierNickname('')
    setRouletteType('european')
    setSpinNumber(0)
    setSpinHistory([])
    setReviewSpins([])
    setCommitSummary(null)
    resetSpinInputs('', 'CW')
    setLayer('layer1')
  }

  return (
    <div className="app">
      {layer === 'layer1' && (
        <div className="layer layer1">
          <h1>Start New Session</h1>
          <input
            type="text"
            placeholder="Table name (e.g., Table 5)"
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Croupier name (e.g., Jean)"
            value={croupierName}
            onChange={(e) => setCroupierName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Croupier nickname (optional)"
            value={croupierNickname}
            onChange={(e) => setCroupierNickname(e.target.value)}
          />
          <div className="input-group">
            <label>Roulette Type</label>
            <select value={rouletteType} onChange={(e) => setRouletteType(e.target.value)}>
              <option value="european">European (single zero)</option>
              <option value="american">American (double zero)</option>
            </select>
          </div>
          <button onClick={handleStartSession}>Start Session</button>
        </div>
      )}

      {layer === 'layer2' && (
        <div className="layer layer2">
          <div className="header">
            <h2>
              {tableName} • {croupierName}
              {croupierNickname ? ` "${croupierNickname}"` : ''} • Spin {spinNumber + 1}
            </h2>
            <button onClick={handleEndSession} disabled={endingSession || spinNumber === 0} className="btn-secondary">
              {endingSession ? 'Loading review…' : 'End Session'}
            </button>
          </div>

          <div className="input-section">
            <div className="input-group">
              <label>Starting Number</label>
              <input
                type="text"
                value={startingNumber}
                onChange={(e) => setStartingNumber(e.target.value)}
                disabled={spinNumber > 0}
                placeholder={rouletteType === 'american' ? '0-36 or 00' : '0-36'}
              />
              {spinNumber > 0 && <span className="auto-filled">(auto-filled)</span>}
            </div>

            <div className="input-group">
              <label>Direction</label>
              <select value={direction} disabled={spinNumber > 0} onChange={(e) => setDirection(e.target.value)}>
                <option value="CW">CW</option>
                <option value="ACW">ACW</option>
              </select>
              {spinNumber > 0 && <span className="auto-filled">(auto-filled)</span>}
            </div>

            <div className="input-group">
              <label>Landed Number</label>
              <input
                type="text"
                placeholder={rouletteType === 'american' ? '0-36 or 00' : '0-36'}
                value={landedNumber}
                onChange={(e) => setLandedNumber(e.target.value)}
              />
            </div>

            <div className="input-group suspect-group">
              <label>Spin Evaluation</label>
              <select
                value={spinStatus}
                onChange={(e) => {
                  setSpinStatus(e.target.value)
                  setSuspectReason('')
                  setSuspectReasonOther('')
                }}
              >
                <option value="CLEAN">CLEAN</option>
                <option value="SUSPECT_CROUPIER">SUSPECT — Croupier</option>
                <option value="SUSPECT_BALL">SUSPECT — Ball</option>
              </select>
            </div>

            {spinStatus === 'SUSPECT_CROUPIER' && (
              <div className="input-group">
                <label>Croupier suspect reason</label>
                <select value={suspectReason} onChange={(e) => setSuspectReason(e.target.value)}>
                  <option value="">Select a reason…</option>
                  {CROUPIER_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {spinStatus === 'SUSPECT_BALL' && (
              <div className="input-group">
                <label>Ball suspect reason</label>
                <select value={suspectReason} onChange={(e) => setSuspectReason(e.target.value)}>
                  <option value="">Select a reason…</option>
                  {BALL_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {suspectReason === 'Other' && (
                  <input
                    type="text"
                    placeholder="Describe what happened"
                    value={suspectReasonOther}
                    onChange={(e) => setSuspectReasonOther(e.target.value)}
                  />
                )}
              </div>
            )}

            <button onClick={handleRecordSpin} className="btn-primary">
              Enter Spin
            </button>
          </div>

          <div className="history-section">
            <h3>Spin History (Latest First)</h3>
            <div className="spin-history">
              {spinHistory.length === 0 ? (
                <p>No spins recorded yet</p>
              ) : (
                spinHistory.map((spin) => (
                  <div key={spin.spinNum} className="spin-entry">
                    Spin {spin.spinNum}: {spin.starting} {spin.direction} → {spin.landed}
                    <span className={`badge status-${spin.spinStatus.toLowerCase()}`}>
                      {spin.spinStatus.replace('_', ' ')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {layer === 'layer3' && (
        <div className="layer layer3">
          <h1>Session Review</h1>
          <h3 className="review-subheader">
            {tableName} • {croupierName}
            {croupierNickname ? ` "${croupierNickname}"` : ''} • {reviewSpins.length} spins recorded
          </h3>

          {commitSummary ? (
            <div className="commit-summary">
              <h2>Session Committed ✅</h2>
              <p>Approved spins: {commitSummary.approvedCount}</p>
              <p>Pattern table writes: {commitSummary.patternWrites}</p>
              <p>Accident log entries: {commitSummary.accidentsLogged}</p>
              <p>Jump events logged: {commitSummary.jumpsLogged}</p>
              <button onClick={handleStartNewSession} className="btn-primary">
                Start New Session
              </button>
            </div>
          ) : (
            <>
              <div className="review-list">
                {reviewSpins.map((spin) => (
                  <div key={spin.id} className={`review-card status-${spin.spin_status.toLowerCase()}`}>
                    <div className="review-card-header">
                      <strong>
                        SPIN {spin.spin_number} ({spin.spin_status.replace('_', ' ')})
                      </strong>
                      <span className={`badge result-${spin.result.toLowerCase().replace(' ', '-')}`}>
                        {spin.result}
                      </span>
                    </div>

                    <p>
                      {formatNumber(spin.starting_number)} {spin.direction} → landed{' '}
                      <strong>{formatNumber(spin.landed_number)}</strong>
                    </p>

                    {spin.spin_status !== 'CLEAN' && (
                      <p className="suspect-detail">
                        {spin.suspect_branch}: {spin.suspect_reason}
                      </p>
                    )}

                    <div className="tier-predictions">
                      {['master', 'table', 'croupier'].map((tierKey) => {
                        const tier = spin[tierKey]
                        const label = tierKey.toUpperCase()
                        const isCanonical = spin.canonicalTier === label
                        return (
                          <div key={tierKey} className={`tier-row${isCanonical ? ' canonical' : ''}`}>
                            <span className="tier-label">{label}</span>
                            <span className="tier-numbers">
                              {tier.numbers.length > 0 ? tier.numbers.map(formatNumber).join(', ') : '—'}
                            </span>
                            <span className="tier-meta">
                              {tier.accuracy}% • {tier.samples} samples • {tier.confidence}
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    <p className="neighbours">
                      Neighbours: {spin.neighbours.map(formatNumber).join(', ')}
                    </p>

                    {spin.result === 'JUMP' && <p className="jump-flag">⚡ Jump event (distance {spin.distance})</p>}

                    <div className="approval-row">
                      {spin.spin_status === 'SUSPECT_BALL' ? (
                        <span className="excluded-note">Excluded automatically — logged to accident log</span>
                      ) : (
                        <label>
                          <input type="checkbox" checked={spin.approved} onChange={() => toggleApproval(spin.id)} />
                          Approve for pattern commit
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button onClick={handleCommit} disabled={committing} className="btn-primary commit-btn">
                {committing ? 'Committing…' : 'Commit & End Session'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
