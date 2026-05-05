import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Filter, ArrowUpDown, Bug, Zap } from 'lucide-react'
import { MOCK_BUGS } from '../data/mockData.js'
import api from '../api/client.js'

const STATUS_LABELS = {
  open: 'Open', triaged: 'Triaged', in_progress: 'In Progress',
  in_review: 'In Review', resolved: 'Resolved', closed: 'Closed', wont_fix: "Won't Fix",
}

const SOURCE_ICONS = {
  runtime: '⚡', ide_auto: '🔍', ide_manual: '✏️', ci: '🔧', monitoring: '📊',
}

export default function BugList() {
  const navigate = useNavigate()
  const [severityFilter, setSeverityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortField, setSortField] = useState('createdAt')
  const [sortDesc, setSortDesc] = useState(true)
  const [liveBugs, setLiveBugs] = useState(null)
  const [loading, setLoading] = useState(true)

  // Fetch bugs from API with mock fallback
  useEffect(() => {
    let cancelled = false
    async function fetchBugs() {
      setLoading(true)
      try {
        const result = await api.listBugs({ limit: 100, sort: 'created_at', order: 'desc' })
        if (!cancelled && result?.bugs) {
          // Normalize API field names to match mock data shape
          setLiveBugs(result.bugs.map(b => ({
            ...b,
            externalId: b.external_id || b.externalId,
            severityScore: b.severity_score || b.severityScore || 0,
            filePath: b.file_path || b.filePath || '',
            lineNumber: b.line_number || b.lineNumber || 0,
            createdAt: b.created_at || b.createdAt,
            source: b.source_type || b.source || 'api',
            assignee: b.assignee_id ? { name: 'Assigned', avatar: 'AU' } : null,
            team: b.team_id || 'Unassigned',
          })))
        }
      } catch {
        // API unavailable — mock data
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchBugs()
    return () => { cancelled = true }
  }, [])

  const bugs = liveBugs || MOCK_BUGS

  const filteredBugs = useMemo(() => {
    let filtered = [...bugs]

    if (severityFilter !== 'all') {
      filtered = filtered.filter(b => b.severity === severityFilter)
    }
    if (statusFilter !== 'all') {
      filtered = filtered.filter(b => b.status === statusFilter)
    }

    filtered.sort((a, b) => {
      const sevOrder = { critical: 5, high: 4, medium: 3, low: 2, info: 1 }
      let cmp = 0
      if (sortField === 'severity') {
        cmp = (sevOrder[a.severity] || 0) - (sevOrder[b.severity] || 0)
      } else if (sortField === 'createdAt') {
        cmp = new Date(a.createdAt) - new Date(b.createdAt)
      } else if (sortField === 'title') {
        cmp = a.title.localeCompare(b.title)
      }
      return sortDesc ? -cmp : cmp
    })

    return filtered
  }, [bugs, severityFilter, statusFilter, sortField, sortDesc])

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDesc(!sortDesc)
    } else {
      setSortField(field)
      setSortDesc(true)
    }
  }

  const formatDate = (iso) => {
    const d = new Date(iso)
    const now = new Date()
    const diffH = Math.floor((now - d) / (1000 * 60 * 60))
    if (diffH < 1) return 'Just now'
    if (diffH < 24) return `${diffH}h ago`
    if (diffH < 48) return 'Yesterday'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="page">
      {/* Top Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bug size={20} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {filteredBugs.length} bug{filteredBugs.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button className="btn btn-primary">
          <Plus size={15} /> Report Bug
        </button>
      </div>

      {/* Bug List Card */}
      <div className="card">
        {/* Filter Bar */}
        <div className="filter-bar">
          <Filter size={14} style={{ color: 'var(--text-tertiary)' }} />

          {['all', 'critical', 'high', 'medium', 'low', 'info'].map(s => (
            <button key={s}
              className={`filter-chip ${severityFilter === s ? 'active' : ''}`}
              onClick={() => setSeverityFilter(s)}
            >
              {s === 'all' ? 'All Severity' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}

          <span style={{ width: 1, height: 20, background: 'var(--border-default)', margin: '0 4px' }} />

          {['all', 'open', 'triaged', 'in_progress', 'resolved', 'closed'].map(s => (
            <button key={s}
              className={`filter-chip ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All Status' : STATUS_LABELS[s] || s}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bug-table-container">
          <table className="bug-table">
            <thead>
              <tr>
                <th style={{ width: 100 }}>ID</th>
                <th onClick={() => handleSort('severity')} style={{ width: 110 }}>
                  Severity <ArrowUpDown size={11} style={{ verticalAlign: -1, opacity: 0.5 }} />
                </th>
                <th onClick={() => handleSort('title')}>
                  Title <ArrowUpDown size={11} style={{ verticalAlign: -1, opacity: 0.5 }} />
                </th>
                <th style={{ width: 120 }}>Status</th>
                <th style={{ width: 100 }}>Category</th>
                <th style={{ width: 140 }}>Assignee</th>
                <th style={{ width: 100 }}>Source</th>
                <th onClick={() => handleSort('createdAt')} style={{ width: 100 }}>
                  Created <ArrowUpDown size={11} style={{ verticalAlign: -1, opacity: 0.5 }} />
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredBugs.map(bug => (
                <tr key={bug.id} onClick={() => navigate(`/bugs/${bug.id}`)}>
                  <td><span className="bug-id">{bug.externalId}</span></td>
                  <td><span className={`severity-badge ${bug.severity}`}>{bug.severity}</span></td>
                  <td>
                    <div className="bug-title-cell">
                      <div className="title">{bug.title}</div>
                      <div className="subtitle">
                        {bug.filePath && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>{bug.filePath.split('/').pop()}</span>}
                        {bug.lineNumber && <span>:{bug.lineNumber}</span>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${bug.status}`}>
                      <span className="dot" />
                      {STATUS_LABELS[bug.status] || bug.status}
                    </span>
                  </td>
                  <td>
                    <span className="category-badge">
                      {bug.category}
                    </span>
                  </td>
                  <td>
                    {bug.assignee ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="avatar" style={{ width: 24, height: 24, fontSize: '0.6rem' }}>
                          {bug.assignee.avatar}
                        </div>
                        <span style={{ fontSize: '0.8rem' }}>{bug.assignee.name}</span>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Unassigned</span>
                    )}
                  </td>
                  <td>
                    <span style={{ fontSize: '0.78rem' }}>
                      {SOURCE_ICONS[bug.source] || '📋'} {bug.source.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                    {formatDate(bug.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredBugs.length === 0 && (
          <div className="empty-state">
            <Bug className="empty-state-icon" size={48} />
            <h3 className="empty-state-title">No bugs match your filters</h3>
            <p className="empty-state-text">Try adjusting severity or status filters to see results.</p>
          </div>
        )}
      </div>
    </div>
  )
}
