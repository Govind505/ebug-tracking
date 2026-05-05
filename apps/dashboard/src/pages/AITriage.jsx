import { useState, useEffect } from 'react'
import {
  Zap, Brain, Target, CheckCircle, XCircle, Clock,
  AlertTriangle, ChevronRight, Sparkles, RotateCcw
} from 'lucide-react'
import { MOCK_BUGS } from '../data/mockData.js'
import api from '../api/client.js'

export default function AITriage() {
  const [selectedBug, setSelectedBug] = useState(null)
  const [triaging, setTriaging] = useState(false)
  const [liveBugs, setLiveBugs] = useState(null)

  // Fetch live bugs from API
  useEffect(() => {
    let cancelled = false
    async function fetchBugs() {
      try {
        const result = await api.listBugs({ limit: 100 })
        if (!cancelled && result?.bugs) setLiveBugs(result.bugs)
      } catch { /* mock fallback */ }
    }
    fetchBugs()
    return () => { cancelled = true }
  }, [])

  const bugs = liveBugs || MOCK_BUGS

  // Bugs that have AI analysis
  const triagedBugs = bugs.filter(b => b.root_cause_suggestion || b.rootCause)
  const pendingBugs = bugs.filter(b => !b.root_cause_suggestion && !b.rootCause && b.status !== 'resolved' && b.status !== 'closed')

  const handleTriage = (bug) => {
    setTriaging(true)
    setSelectedBug(bug)
    setTimeout(() => setTriaging(false), 2000)
  }

  const pipelineStages = [
    { name: 'Ingestion', icon: '📥', count: MOCK_BUGS.length, color: 'var(--accent-primary)' },
    { name: 'Dedup Check', icon: '🔍', count: MOCK_BUGS.filter(b => !b.is_duplicate).length, color: 'var(--severity-info)' },
    { name: 'Severity Score', icon: '⚡', count: MOCK_BUGS.filter(b => b.severity_score).length, color: 'var(--severity-medium)' },
    { name: 'Root Cause', icon: '🧠', count: triagedBugs.length, color: 'var(--severity-high)' },
    { name: 'Triaged', icon: '✅', count: MOCK_BUGS.filter(b => b.status === 'triaged').length, color: 'var(--severity-info)' },
  ]

  const severityColors = {
    critical: 'var(--severity-critical)', high: 'var(--severity-high)',
    medium: 'var(--severity-medium)', low: 'var(--severity-low)', info: 'var(--severity-info)',
  }

  return (
    <div className="page">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>AI Triage Pipeline</h3>
          <span style={{
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
            color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
          }}>POWERED BY AI</span>
        </div>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          Automated severity scoring, root cause analysis, and intelligent triage
        </p>
      </div>

      {/* AI Pipeline Visualization */}
      <div className="card" style={{ padding: 20, marginBottom: 24 }}>
        <h4 style={{ margin: '0 0 16px', color: 'var(--text-primary)', fontSize: 14 }}>Pipeline Flow</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto' }}>
          {pipelineStages.map((stage, i) => (
            <div key={stage.name} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                padding: '16px 24px', background: 'var(--bg-tertiary)', borderRadius: 12,
                minWidth: 110, border: '1px solid var(--border-primary)',
              }}>
                <span style={{ fontSize: 28 }}>{stage.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{stage.name}</span>
                <span style={{
                  fontSize: 20, fontWeight: 700, color: stage.color,
                }}>{stage.count}</span>
              </div>
              {i < pipelineStages.length - 1 && (
                <ChevronRight size={20} style={{ color: 'var(--text-muted)', margin: '0 4px', flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* AI Model Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">AI Accuracy</span>
            <Target size={16} style={{ color: 'var(--severity-info)' }} />
          </div>
          <div className="stat-value">87.3%</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Hybrid model (rule + ML)</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Avg Triage Time</span>
            <Clock size={16} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div className="stat-value">1.8s</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>End-to-end pipeline</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Auto-Triaged</span>
            <Sparkles size={16} style={{ color: 'var(--severity-medium)' }} />
          </div>
          <div className="stat-value">{triagedBugs.length}/{MOCK_BUGS.length}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {Math.round((triagedBugs.length / MOCK_BUGS.length) * 100)}% automation rate
          </div>
        </div>
      </div>

      {/* Two Columns: Pending + Detail */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Pending Triage */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 14 }}>
              Pending Analysis ({pendingBugs.length})
            </h4>
            <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 11 }}>
              <Zap size={12} /> Triage All
            </button>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {pendingBugs.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <CheckCircle size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                <p style={{ fontSize: 13 }}>All bugs have been analyzed!</p>
              </div>
            ) : (
              pendingBugs.map(bug => (
                <div key={bug.id} onClick={() => handleTriage(bug)} style={{
                  padding: '12px 20px', borderBottom: '1px solid var(--border-primary)',
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span className={`severity-badge severity-${bug.severity}`}>{bug.severity}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{bug.external_id}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{bug.title}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* AI Analysis Detail */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)' }}>
            <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 14 }}>
              <Brain size={14} style={{ marginRight: 6 }} />
              AI Analysis
            </h4>
          </div>
          {selectedBug ? (
            <div style={{ padding: 20 }}>
              {triaging ? (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <RotateCcw size={32} className="spin" style={{ color: 'var(--accent-primary)', marginBottom: 12 }} />
                  <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Running AI analysis pipeline...</p>
                  <div style={{
                    height: 4, background: 'var(--bg-tertiary)', borderRadius: 2, marginTop: 16, overflow: 'hidden',
                  }}>
                    <div className="shimmer" style={{
                      height: '100%', width: '60%',
                      background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-secondary))',
                      borderRadius: 2,
                    }} />
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <span className={`severity-badge severity-${selectedBug.severity}`}>{selectedBug.severity}</span>
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>{selectedBug.external_id}</span>
                    <h4 style={{ margin: '8px 0 4px', color: 'var(--text-primary)', fontSize: 14 }}>{selectedBug.title}</h4>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Severity Scoring
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 8, background: 'var(--bg-tertiary)', borderRadius: 4 }}>
                        <div style={{
                          width: `${(selectedBug.severity_score || 0.5) * 100}%`,
                          height: '100%', borderRadius: 4,
                          background: severityColors[selectedBug.severity] || 'var(--accent-primary)',
                        }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {((selectedBug.severity_score || 0.5) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  {selectedBug.root_cause_suggestion && (
                    <div style={{
                      background: 'var(--bg-tertiary)', padding: 14, borderRadius: 8,
                      borderLeft: '3px solid var(--accent-primary)', marginBottom: 16,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)', marginBottom: 6 }}>
                        🧠 ROOT CAUSE ANALYSIS
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                        {selectedBug.root_cause_suggestion}
                      </p>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button className="btn-primary" style={{ flex: 1, fontSize: 12 }}>
                      <CheckCircle size={12} /> Accept
                    </button>
                    <button className="btn-ghost" style={{ flex: 1, fontSize: 12 }}>
                      <XCircle size={12} /> Override
                    </button>
                    <button className="btn-ghost" style={{ fontSize: 12 }}>
                      <RotateCcw size={12} /> Re-run
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <Brain size={40} style={{ opacity: 0.2, marginBottom: 12 }} />
              <p style={{ fontSize: 13, margin: 0 }}>Select a bug to view AI analysis</p>
            </div>
          )}
        </div>
      </div>

      {/* Recently Triaged */}
      <div className="card" style={{ padding: 0, marginTop: 24 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)' }}>
          <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 14 }}>Recently Auto-Triaged</h4>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
              <th style={{ textAlign: 'left', padding: '10px 20px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Bug</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Severity</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Category</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Confidence</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Root Cause</th>
            </tr>
          </thead>
          <tbody>
            {triagedBugs.slice(0, 6).map(bug => (
              <tr key={bug.id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                <td style={{ padding: '10px 20px' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{bug.external_id}</span>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{bug.title}</div>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span className={`severity-badge severity-${bug.severity}`}>{bug.severity}</span>
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                  {bug.category}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {((bug.severity_score || 0.7) * 100).toFixed(0)}%
                  </span>
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {bug.root_cause_suggestion?.slice(0, 80) || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
