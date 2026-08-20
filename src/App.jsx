import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { rankCandidates, baselineRate } from './predictions'
import './App.css'

const PREDICTION_THRESHOLD = 10 // once this many spins are recorded, Layer 3 takes over

export default function App() {
  const [layer, setLayer] = useState('layer1') // layer1, layer2, layer3
  const [tableId, setTableId] = useState('')
  const [croupierId, setCroupierId] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [spinNumber, setSpinNumber] = useState(0)
  const [startingNumber, setStartingNumber] = useState('')
  const [direction, setDirection] = useState('CW')
  const [landedNumber, setLandedNumber] = useState('')
  const [spinHistory, setSpinHistory] = useState([])
  const [prediction, setPrediction] = useState(null)
  const [predictionResult, setPredictionResult] = useState('')
  const [predictionLoading, setPredictionLoading] = useState(false)

  // Once past the threshold, Layer 2's plain form stops being used — instead, every
  // spin is recorded through the Layer 3 tracking modal, which fetches a real
  // prediction for (startingNumber, direction) before asking what actually landed.
  useEffect(() => {
    if (spinNumber < PREDICTION_THRESHOLD) return
    if (prediction || predictionLoading) return
    fetchTracking(startingNumber, direction)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinNumber, startingNumber, direction])

  // LAYER 1: Start Session
  const handleStartSession = async () => {
    if (!tableId.trim() || !croupierId.trim()) {
      alert('Enter table name and croupier name')
      return
    }

    const { data, error } = await supabase
      .from('sessions')
      .insert([{ table_id: tableId.trim(), croupier_id: croupierId.trim() }])
      .select()

    if (error) {
      console.error('Error creating session:', error)
      alert('Failed to start session')
      return
    }

    setSessionId(data[0].id)
    setSpinNumber(0)
    setLayer('layer2')
  }

  // LAYER 2: Record Spin (spins 1 through PREDICTION_THRESHOLD only — plain entry, no prediction)
  const handleRecordSpin = async () => {
    if (spinNumber === 0) {
      if (startingNumber === '' || Number(startingNumber) < 0 || Number(startingNumber) > 36) {
        alert('Enter starting number (0-36)')
        return
      }
    }
    if (landedNumber === '' || Number(landedNumber) < 0 || Number(landedNumber) > 36) {
      alert('Enter landed number (0-36)')
      return
    }

    const newSpinNum = spinNumber + 1

    const { error } = await supabase.from('spins').insert([
      {
        session_id: sessionId,
        table_id: tableId,
        croupier_id: croupierId,
        spin_number: newSpinNum,
        starting_number: parseInt(startingNumber, 10),
        direction: direction,
        landed_number: parseInt(landedNumber, 10),
      },
    ])

    if (error) {
      console.error('Error recording spin:', error)
      alert('Failed to save spin')
      return
    }

    setSpinHistory([
      { spinNum: newSpinNum, starting: startingNumber, direction, landed: landedNumber, hitOrMiss: null },
      ...spinHistory,
    ])

    setSpinNumber(newSpinNum)
    setStartingNumber(landedNumber)
    setDirection(direction === 'CW' ? 'ACW' : 'CW')
    setLandedNumber('')
  }

  // LAYER 3: fetch a real prediction from master_spin_patterns for (startNum, dir)
  const fetchTracking = async (startNum, dir) => {
    if (startNum === '' || !dir) return
    setPredictionLoading(true)
    try {
      const { data, error } = await supabase
        .from('master_spin_patterns')
        .select('*')
        .eq('starting_number', parseInt(startNum, 10))
        .eq('direction', dir)
        .order('accuracy', { ascending: false })
        .order('frequency', { ascending: false })
        .limit(10)

      if (error) {
        console.error('Error fetching tracking data:', error)
        setPrediction({ startingNumber: startNum, direction: dir, trackedNumbers: [], accuracy: 0, hitCount: 0, baseline: 0 })
        return
      }

      const ranked = rankCandidates(data || [])
      const top5 = ranked.slice(0, 5)

      setPrediction({
        startingNumber: startNum,
        direction: dir,
        trackedNumbers: top5.map((r) => r.landed_number),
        accuracy: top5[0]?.accuracy ?? 0,
        hitCount: top5[0]?.hit_count ?? 0,
        baseline: baselineRate(top5.length),
      })
    } finally {
      setPredictionLoading(false)
    }
  }

  // LAYER 3: user confirms what actually landed
  const handleTrackingResult = async () => {
    if (predictionResult === '' || Number(predictionResult) < 0 || Number(predictionResult) > 36) {
      alert('Enter landed number (0-36)')
      return
    }
    if (!prediction) return

    const resultNum = parseInt(predictionResult, 10)
    const isHit = prediction.trackedNumbers.includes(resultNum)
    const newSpinNum = spinNumber + 1

    // Record the spin itself (the original mock code tried to UPDATE a spin row that
    // was never inserted for this spin number, which silently saved nothing).
    const { error: insertError } = await supabase.from('spins').insert([
      {
        session_id: sessionId,
        table_id: tableId,
        croupier_id: croupierId,
        spin_number: newSpinNum,
        starting_number: parseInt(prediction.startingNumber, 10),
        direction: prediction.direction,
        landed_number: resultNum,
        hit_or_miss: isHit ? 'HIT' : 'MISS',
      },
    ])
    if (insertError) console.error('Error recording tracked spin:', insertError)

    // Update the pattern row for the actual outcome via the accumulating RPC function,
    // on both HIT and MISS, so accuracy reflects real hit rate over time (the original
    // mock code only ran a flat, non-accumulating upsert, and only on HIT).
    const { error: rpcError } = await supabase.rpc('upsert_pattern', {
      p_starting_num: parseInt(prediction.startingNumber, 10),
      p_direction: prediction.direction,
      p_landed_num: resultNum,
      p_hit: isHit,
    })
    if (rpcError) console.error('Error updating pattern:', rpcError)

    setSpinHistory([
      {
        spinNum: newSpinNum,
        starting: prediction.startingNumber,
        direction: prediction.direction,
        landed: resultNum,
        hitOrMiss: isHit ? 'HIT' : 'MISS',
      },
      ...spinHistory,
    ])

    setSpinNumber(newSpinNum)
    setStartingNumber(resultNum.toString())
    setDirection(prediction.direction === 'CW' ? 'ACW' : 'CW')

    setLayer('layer2')
    setPrediction(null)
    setPredictionResult('')
  }

  return (
    <div className="app">
      {layer === 'layer1' && (
        <div className="layer layer1">
          <h1>Start New Session</h1>
          <input
            type="text"
            placeholder="Table name (e.g., Table 5)"
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
          />
          <input
            type="text"
            placeholder="Croupier name (e.g., Jean)"
            value={croupierId}
            onChange={(e) => setCroupierId(e.target.value)}
          />
          <button onClick={handleStartSession}>Start Session</button>
        </div>
      )}

      {layer === 'layer2' && (
        <div className="layer layer2">
          <div className="header">
            <h2>
              {tableId} • {croupierId} • Spin {spinNumber + 1}
            </h2>
          </div>

          <div className="input-section">
            <div className="input-group">
              <label>Starting Number</label>
              <input
                type="number"
                value={startingNumber}
                onChange={(e) => setStartingNumber(e.target.value)}
                disabled={spinNumber > 0}
                min="0"
                max="36"
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
                type="number"
                placeholder="Enter 0-36"
                value={landedNumber}
                onChange={(e) => setLandedNumber(e.target.value)}
                min="0"
                max="36"
              />
            </div>

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
                    {spin.hitOrMiss && <span className={`badge ${spin.hitOrMiss.toLowerCase()}`}>{spin.hitOrMiss}</span>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {layer === 'layer3' && (
        <div className="layer layer3 modal">
          <div className="modal-content">
            <h2>🎯 Next Spin Tracking</h2>

            {predictionLoading || !prediction ? (
              <p>Loading tracking data…</p>
            ) : (
              <>
                <div className="tracking-info">
                  <p>
                    <strong>Starting from:</strong> {prediction.startingNumber}
                  </p>
                  <p>
                    <strong>Direction:</strong> {prediction.direction}
                  </p>
                  <p>
                    <strong>Tracked numbers (top {prediction.trackedNumbers.length || 5}):</strong>
                  </p>
                  {prediction.trackedNumbers.length > 0 ? (
                    <div className="tracked-numbers">
                      {prediction.trackedNumbers.map((num) => (
                        <span key={num} className="number-badge">
                          {num}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p>No historical pattern data yet for this starting number + direction.</p>
                  )}
                  {prediction.trackedNumbers.length > 0 && (
                    <p>
                      <strong>Historical accuracy:</strong> {prediction.accuracy}% ({prediction.hitCount} hits) — chance
                      baseline for a {prediction.trackedNumbers.length}-number pick is {prediction.baseline}%.
                    </p>
                  )}
                </div>

                <div className="input-group">
                  <label>What actually landed?</label>
                  <input
                    type="number"
                    placeholder="Enter 0-36"
                    value={predictionResult}
                    onChange={(e) => setPredictionResult(e.target.value)}
                    min="0"
                    max="36"
                  />
                </div>

                <button onClick={handleTrackingResult} className="btn-primary">
                  Confirm
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
