import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, GitPullRequest, ExternalLink, Clock, User,
  Zap, Cpu, FileCode, MapPin, Sparkles
} from 'lucide-react'
import { MOCK_BUGS, MOCK_ACTIVITY } from '../data/mockData.js'
import api from '../api/client.js'

const STATUS_LABELS = {
  open: 'Open', triaged: 'Triaged', in_progress: 'In Progress',
  in_review: 'In Review', resolved: 'Resolved', closed: 'Closed', wont_fix: "Won't Fix",
}

export default function BugDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [liveBug, setLiveBug] = useState(null)
  const [liveActivity, setLiveActivity] = useState(null)

  // Fetch from API, fall back to mock
  useEffect(() => {
    let cancelled = false
    async function fetchBug() {
      try {
        const [bugResult, actResult] = await Promise.all([
          api.getBug(id),
          api.getBugActivity(id),
        ])
        if (cancelled) return
        if (bugResult?.bug) {
          // Normalize API field names
          const b = bugResult.bug
          setLiveBug({
            ...b,
            externalId: b.external_id || b.externalId,
            severityScore: b.severity_score || b.severityScore || 0,
            filePath: b.file_path || b.filePath,
            lineNumber: b.line_number || b.lineNumber,
            createdAt: b.created_at || b.createdAt,
            createdBy: b.created_by || 'System',
            rootCause: b.root_cause_suggestion || b.rootCause,
            suggestedFix: b.suggested_fix || b.suggestedFix,
            stackTrace: b.stack_trace || b.stackTrace,
            prUrls: b.pr_urls || b.prUrls || [],
            source: b.source_type || b.source || 'api',
            assignee: b.assignee_id ? { name: 'Assigned', avatar: 'AU' } : b.assignee,
            team: b.team_id || b.team || 'Unassigned',
            environment: b.runtime_env || b.environment,
          })
        }
        if (actResult?.activities) {
          setLiveActivity(actResult.activities.map(a => ({
            ...a,
            actor: a.actor_id || a.actor || 'System',
            action: a.action,
            time: new Date(a.created_at || a.createdAt).toLocaleString(),
          })))
        }
      } catch {
        // API unavailable — use mock data
      }
    }
    fetchBug()
    return () => { cancelled = true }
  }, [id])

  const bug = liveBug || MOCK_BUGS.find(b => b.id === id)
  if (!bug) {
    return (
      <div className="page">
        <div className="empty-state">
          <h3 className="empty-state-title">Bug not found</h3>
          <p className="empty-state-text">The bug report you're looking for doesn't exist.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/bugs')}>
            <ArrowLeft size={15} /> Back to Bugs
          </button>
        </div>
      </div>
    )
  }

  const activities = liveActivity || MOCK_ACTIVITY.filter(a => a.bugId === bug.id)

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Back + Header */}
      <button className="btn btn-ghost" onClick={() => navigate('/bugs')} style={{ marginBottom: 16 }}>
        <ArrowLeft size={15} /> Back to Bug List
      </button>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Main Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title Card */}
          <div className="card animate-in" style={{ marginBottom: 16 }}>
            <div className="card-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span className="bug-id" style={{ fontSize: '0.9rem' }}>{bug.externalId}</span>
                <span className={`severity-badge ${bug.severity}`}>{bug.severity} ({(bug.severityScore * 100).toFixed(0)}%)</span>
                <span className={`status-badge ${bug.status}`}>
                  <span className="dot" />
                  {STATUS_LABELS[bug.status]}
                </span>
              </div>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.35, marginBottom: 12 }}>
                {bug.title}
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.7 }}>
                {bug.description}
              </p>
            </div>
          </div>

          {/* AI Root Cause Analysis */}
          {bug.rootCause && (
            <div className="card animate-in" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title"><Sparkles size={14} style={{ color: 'var(--accent-primary)', marginRight: 6, verticalAlign: -2 }} /> AI Root Cause Analysis</span>
              </div>
              <div className="card-body">
                <div className="ai-suggestion">
                  <div className="ai-suggestion-header">
                    <Zap size={14} /> Root Cause Identified
                  </div>
                  <p className="ai-suggestion-text">{bug.rootCause}</p>
                </div>
                {bug.suggestedFix && (
                  <div className="ai-suggestion" style={{ marginTop: 12, borderColor: 'rgba(34, 197, 94, 0.3)', background: 'rgba(34, 197, 94, 0.08)' }}>
                    <div className="ai-suggestion-header" style={{ color: 'var(--severity-low)' }}>
                      <Cpu size={14} /> Suggested Fix
                    </div>
                    <p className="ai-suggestion-text">{bug.suggestedFix}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Stack Trace */}
          {bug.stackTrace && (
            <div className="card animate-in" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">Stack Trace</span>
              </div>
              <div className="card-body">
                <pre className="stack-trace-block">{bug.stackTrace}</pre>
              </div>
            </div>
          )}

          {/* Linked PRs */}
          {bug.prUrls && bug.prUrls.length > 0 && (
            <div className="card animate-in" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">Linked Pull Requests</span>
              </div>
              <div className="card-body">
                {bug.prUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                      background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
                      marginBottom: 8, fontSize: '0.85rem', color: 'var(--accent-primary)',
                      border: '1px solid var(--border-default)', transition: 'all 150ms',
                    }}
                    onMouseOver={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                    onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
                  >
                    <GitPullRequest size={15} />
                    <span style={{ flex: 1 }}>{url.split('/').slice(-2).join(' #')}</span>
                    <ExternalLink size={13} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Activity Timeline */}
          {activities.length > 0 && (
            <div className="card animate-in">
              <div className="card-header">
                <span className="card-title">Activity Timeline</span>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {activities.map((act, i) => (
                  <div key={act.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 22px',
                    borderBottom: i < activities.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-hover)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {act.actor.includes('AI') ? <Zap size={12} style={{ color: 'var(--accent-primary)' }} /> :
                       <User size={12} style={{ color: 'var(--text-tertiary)' }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{act.actor}</span>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginLeft: 6 }}>{act.action}</span>
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      <Clock size={11} style={{ marginRight: 3, verticalAlign: -1 }} />{act.time}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar — Metadata */}
        <div style={{ width: 300, flexShrink: 0 }}>
          <div className="card animate-in" style={{ position: 'sticky', top: 'calc(var(--header-height) + 28px)' }}>
            <div className="card-body">
              {/* Status */}
              <div className="detail-field">
                <div className="detail-field-label">Status</div>
                <span className={`status-badge ${bug.status}`}>
                  <span className="dot" /> {STATUS_LABELS[bug.status]}
                </span>
              </div>

              {/* Severity */}
              <div className="detail-field">
                <div className="detail-field-label">Severity</div>
                <span className={`severity-badge ${bug.severity}`}>{bug.severity}</span>
                <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                  ({(bug.severityScore * 100).toFixed(0)}% confidence)
                </span>
              </div>

              {/* Category */}
              <div className="detail-field">
                <div className="detail-field-label">Category</div>
                <div className="detail-field-value">{bug.category}</div>
              </div>

              {/* Assignee */}
              <div className="detail-field">
                <div className="detail-field-label">Assignee</div>
                {bug.assignee ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="avatar" style={{ width: 26, height: 26, fontSize: '0.6rem' }}>{bug.assignee.avatar}</div>
                    <span className="detail-field-value">{bug.assignee.name}</span>
                  </div>
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Unassigned</span>
                )}
              </div>

              {/* Team */}
              <div className="detail-field">
                <div className="detail-field-label">Team</div>
                <div className="detail-field-value">{bug.team}</div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 8, paddingTop: 14 }}>
                {/* File Location */}
                {bug.filePath && (
                  <div className="detail-field">
                    <div className="detail-field-label"><FileCode size={11} style={{ verticalAlign: -1, marginRight: 3 }} /> Location</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--accent-primary)', wordBreak: 'break-all' }}>
                      {bug.filePath}
                      {bug.lineNumber && <span style={{ color: 'var(--severity-medium)' }}>:{bug.lineNumber}</span>}
                    </div>
                  </div>
                )}

                {/* Environment */}
                {bug.environment && (
                  <div className="detail-field">
                    <div className="detail-field-label"><MapPin size={11} style={{ verticalAlign: -1, marginRight: 3 }} /> Environment</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {Object.entries(bug.environment).map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                          <span style={{ color: 'var(--text-tertiary)' }}>{k}</span>
                          <span>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Source */}
                <div className="detail-field">
                  <div className="detail-field-label">Source</div>
                  <div className="detail-field-value">{bug.source.replace('_', ' ')}</div>
                </div>

                {/* Created */}
                <div className="detail-field">
                  <div className="detail-field-label">Created</div>
                  <div className="detail-field-value" style={{ fontSize: '0.8rem' }}>
                    {new Date(bug.createdAt).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    by {bug.createdBy}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
