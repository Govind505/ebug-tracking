import { useState, useEffect, useMemo } from 'react'
import {
  BarChart3, TrendingUp, TrendingDown, Clock, Bug,
  AlertTriangle, Shield, Cpu, Layers, ArrowUpRight,
  Calendar, Filter
} from 'lucide-react'
import { MOCK_BUGS } from '../data/mockData.js'
import api from '../api/client.js'

export default function Analytics() {
  const [timeRange, setTimeRange] = useState('30d')
  const [liveBugs, setLiveBugs] = useState(null)
  const [liveStats, setLiveStats] = useState(null)

  // Fetch live data
  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      try {
        const [bugsResult, statsResult] = await Promise.all([
          api.listBugs({ limit: 200 }),
          api.getStats(),
        ])
        if (cancelled) return
        if (bugsResult?.bugs) setLiveBugs(bugsResult.bugs)
        if (statsResult) setLiveStats(statsResult)
      } catch {
        // Fall back to mock data
      }
    }
    fetchData()
    return () => { cancelled = true }
  }, [])

  const bugs = liveBugs || MOCK_BUGS

  // Compute analytics from data
  const totalBugs = bugs.length
  const openBugs = bugs.filter(b => !['resolved', 'closed'].includes(b.status)).length
  const resolvedBugs = bugs.filter(b => b.status === 'resolved' || b.status === 'closed').length
  const criticalOpen = bugs.filter(b => b.severity === 'critical' && b.status !== 'resolved' && b.status !== 'closed').length

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  const categoryCounts = {}
  const statusCounts = {}
  const fileHotspots = {}

  bugs.forEach(b => {
    severityCounts[b.severity] = (severityCounts[b.severity] || 0) + 1
    categoryCounts[b.category] = (categoryCounts[b.category] || 0) + 1
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1
    const fp = b.file_path || b.filePath
    if (fp) {
      const dir = fp.split('/').slice(0, -1).join('/')
      fileHotspots[dir] = (fileHotspots[dir] || 0) + 1
    }
  })

  const resolutionRate = totalBugs > 0 ? Math.round((resolvedBugs / totalBugs) * 100) : 0

  // Simulated trend data for charts
  const weeklyTrend = [
    { week: 'W1', created: 8, resolved: 5 },
    { week: 'W2', created: 12, resolved: 9 },
    { week: 'W3', created: 6, resolved: 8 },
    { week: 'W4', created: 15, resolved: 11 },
  ]

  const severityColors = {
    critical: 'var(--severity-critical)',
    high: 'var(--severity-high)',
    medium: 'var(--severity-medium)',
    low: 'var(--severity-low)',
    info: 'var(--severity-info)',
  }

  const maxSeverityCount = Math.max(...Object.values(severityCounts))
  const maxCategoryCount = Math.max(...Object.values(categoryCounts))
  const sortedHotspots = Object.entries(fileHotspots).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const maxHotspot = sortedHotspots.length > 0 ? sortedHotspots[0][1] : 1

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Analytics Overview</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Insights across {totalBugs} bug reports
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['7d', '30d', '90d'].map(range => (
            <button
              key={range}
              className={timeRange === range ? 'btn-primary' : 'btn-ghost'}
              style={{ padding: '6px 14px', fontSize: 12 }}
              onClick={() => setTimeRange(range)}
            >
              {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : '90 Days'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Total Bugs</span>
            <Bug size={16} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div className="stat-value">{totalBugs}</div>
          <div className="stat-trend trend-up">
            <TrendingUp size={12} /> +23% from last period
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Open Bugs</span>
            <AlertTriangle size={16} style={{ color: 'var(--severity-high)' }} />
          </div>
          <div className="stat-value">{openBugs}</div>
          <div className="stat-trend trend-down">
            <TrendingDown size={12} /> -8% from last period
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Resolution Rate</span>
            <BarChart3 size={16} style={{ color: 'var(--severity-info)' }} />
          </div>
          <div className="stat-value">{resolutionRate}%</div>
          <div className="stat-trend trend-up">
            <TrendingUp size={12} /> +5% improvement
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Critical Open</span>
            <Shield size={16} style={{ color: 'var(--severity-critical)' }} />
          </div>
          <div className="stat-value" style={{ color: criticalOpen > 0 ? 'var(--severity-critical)' : 'var(--text-primary)' }}>
            {criticalOpen}
          </div>
          <div className="stat-trend" style={{ color: 'var(--text-muted)' }}>
            <Clock size={12} /> Avg 4.2h to triage
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Severity Distribution */}
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ margin: '0 0 16px', color: 'var(--text-primary)', fontSize: 14 }}>Severity Distribution</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(severityCounts).map(([sev, count]) => (
              <div key={sev} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 60, fontSize: 12, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{sev}</span>
                <div style={{ flex: 1, height: 24, background: 'var(--bg-tertiary)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(count / maxSeverityCount) * 100}%`,
                    height: '100%',
                    background: severityColors[sev],
                    borderRadius: 6,
                    transition: 'width 0.6s ease',
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8,
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>{count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ margin: '0 0 16px', color: 'var(--text-primary)', fontSize: 14 }}>Category Breakdown</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(categoryCounts).map(([cat, count]) => {
              const icons = { crash: '💥', security: '🔒', perf: '⚡', logic: '🧠', ui: '🎨', dependency: '📦' }
              return (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 24, textAlign: 'center' }}>{icons[cat] || '🐛'}</span>
                  <span style={{ width: 80, fontSize: 12, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{cat}</span>
                  <div style={{ flex: 1, height: 24, background: 'var(--bg-tertiary)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{
                      width: `${(count / maxCategoryCount) * 100}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-secondary))',
                      borderRadius: 6,
                      transition: 'width 0.6s ease',
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8,
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>{count}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Second Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Weekly Trend */}
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ margin: '0 0 16px', color: 'var(--text-primary)', fontSize: 14 }}>Weekly Trend</h4>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', height: 160, paddingTop: 8 }}>
            {weeklyTrend.map(w => {
              const maxVal = Math.max(...weeklyTrend.map(t => Math.max(t.created, t.resolved)))
              return (
                <div key={w.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 120 }}>
                    <div style={{
                      width: 20, height: `${(w.created / maxVal) * 100}%`,
                      background: 'var(--severity-high)', borderRadius: '4px 4px 0 0',
                      minHeight: 8, transition: 'height 0.5s ease',
                    }} title={`Created: ${w.created}`} />
                    <div style={{
                      width: 20, height: `${(w.resolved / maxVal) * 100}%`,
                      background: 'var(--severity-info)', borderRadius: '4px 4px 0 0',
                      minHeight: 8, transition: 'height 0.5s ease',
                    }} title={`Resolved: ${w.resolved}`} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{w.week}</span>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--severity-high)' }} /> Created
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--severity-info)' }} /> Resolved
            </span>
          </div>
        </div>

        {/* Status Pipeline */}
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ margin: '0 0 16px', color: 'var(--text-primary)', fontSize: 14 }}>Status Pipeline</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(statusCounts).map(([status, count]) => {
              const statusColors = {
                open: '#ef4444', triaged: '#f59e0b', in_progress: '#3b82f6',
                in_review: '#8b5cf6', resolved: '#10b981', closed: '#6b7280',
              }
              return (
                <div key={status} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', background: 'var(--bg-tertiary)', borderRadius: 8,
                  borderLeft: `3px solid ${statusColors[status] || '#6b7280'}`,
                }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                    {status.replace('_', ' ')}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* File Hotspots */}
      <div className="card" style={{ padding: 20 }}>
        <h4 style={{ margin: '0 0 16px', color: 'var(--text-primary)', fontSize: 14 }}>
          🔥 Bug Hotspots (Most Affected Paths)
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sortedHotspots.map(([path, count], i) => (
            <div key={path} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 20, fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>#{i + 1}</span>
              <code style={{ flex: 1, fontSize: 12, color: 'var(--accent-primary)', background: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: 4 }}>
                {path || '(root)'}
              </code>
              <div style={{ width: 120, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3 }}>
                <div style={{
                  width: `${(count / maxHotspot) * 100}%`,
                  height: '100%', borderRadius: 3,
                  background: i === 0 ? 'var(--severity-critical)' : i < 3 ? 'var(--severity-high)' : 'var(--accent-primary)',
                }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', width: 24, textAlign: 'right' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
