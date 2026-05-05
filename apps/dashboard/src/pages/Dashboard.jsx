import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Bug, CheckCircle2, Clock, TrendingUp,
  TrendingDown, ArrowRight, Zap, Activity
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts'
import { MOCK_BUGS, MOCK_ACTIVITY, MOCK_TREND_DATA } from '../data/mockData.js'
import api from '../api/client.js'

const SEVERITY_COLORS = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  info: '#6366f1',
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [liveStats, setLiveStats] = useState(null)
  const [liveBugs, setLiveBugs] = useState(null)
  const [apiConnected, setApiConnected] = useState(false)

  // Attempt to fetch live data from API, fall back to mock data
  useEffect(() => {
    let cancelled = false
    async function fetchLiveData() {
      try {
        const [statsResult, bugsResult] = await Promise.all([
          api.getStats(),
          api.listBugs({ limit: 50, sort: 'created_at', order: 'desc' }),
        ])
        if (cancelled) return
        if (statsResult) {
          setLiveStats(statsResult)
          setApiConnected(true)
        }
        if (bugsResult?.bugs) {
          setLiveBugs(bugsResult.bugs)
        }
      } catch {
        // API unavailable — mock data used
      }
    }
    fetchLiveData()
    // Poll every 30 seconds
    const interval = setInterval(fetchLiveData, 30_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const bugs = liveBugs || MOCK_BUGS

  const stats = useMemo(() => {
    if (liveStats) {
      const openCount = (liveStats.by_status?.open || 0) + (liveStats.by_status?.triaged || 0) +
                        (liveStats.by_status?.in_progress || 0) + (liveStats.by_status?.in_review || 0)
      return {
        totalOpen: openCount,
        critical: liveStats.by_severity?.critical || 0,
        resolved24h: liveStats.last_24h || 0,
        avgScore: liveStats.avg_resolution_hours ? `${liveStats.avg_resolution_hours}h` : 'N/A',
      }
    }
    const open = bugs.filter(b => !['resolved', 'closed'].includes(b.status))
    return {
      totalOpen: open.length,
      critical: open.filter(b => b.severity === 'critical').length,
      resolved24h: bugs.filter(b => b.status === 'resolved').length,
      avgScore: (bugs.reduce((s, b) => s + (b.severityScore || 0), 0) / bugs.length).toFixed(2),
    }
  }, [liveStats, bugs])

  const severityDistribution = useMemo(() => {
    if (liveStats?.by_severity) {
      return Object.entries(liveStats.by_severity).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        color: SEVERITY_COLORS[name] || '#6b7280',
      }))
    }
    const counts = {}
    bugs.forEach(b => {
      counts[b.severity] = (counts[b.severity] || 0) + 1
    })
    return Object.entries(counts).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: SEVERITY_COLORS[name] || '#6b7280',
    }))
  }, [liveStats, bugs])

  return (
    <div className="page">
      {/* Stat Cards */}
      <div className="stats-grid">
        <div className="stat-card animate-in">
          <div className="stat-card-header">
            <span className="stat-card-label">Open Bugs</span>
            <div className="stat-card-icon critical">
              <Bug size={18} />
            </div>
          </div>
          <div className="stat-card-value">{stats.totalOpen}</div>
          <div className="stat-card-change up">
            <TrendingUp size={13} /> +3 from yesterday
          </div>
        </div>

        <div className="stat-card animate-in">
          <div className="stat-card-header">
            <span className="stat-card-label">Critical Issues</span>
            <div className="stat-card-icon" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444' }}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <div className="stat-card-value" style={{ color: 'var(--severity-critical)' }}>{stats.critical}</div>
          <div className="stat-card-change up">
            <TrendingUp size={13} /> +1 today
          </div>
        </div>

        <div className="stat-card animate-in">
          <div className="stat-card-header">
            <span className="stat-card-label">Resolved (7d)</span>
            <div className="stat-card-icon resolved">
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div className="stat-card-value" style={{ color: 'var(--severity-low)' }}>{stats.resolved24h}</div>
          <div className="stat-card-change down">
            <TrendingDown size={13} /> Improving
          </div>
        </div>

        <div className="stat-card animate-in">
          <div className="stat-card-header">
            <span className="stat-card-label">AI Confidence</span>
            <div className="stat-card-icon info">
              <Zap size={18} />
            </div>
          </div>
          <div className="stat-card-value">{stats.avgScore}</div>
          <div className="stat-card-change down">
            <Activity size={13} /> Avg severity score
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="charts-grid">
        {/* Trend Chart */}
        <div className="card animate-in">
          <div className="card-header">
            <span className="card-title">Bug Trend (7 Days)</span>
          </div>
          <div className="chart-container" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={MOCK_TREND_DATA} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradOpened" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradCritical" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: '#1e2030', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    color: '#f1f5f9', fontSize: 13,
                  }}
                />
                <Area type="monotone" dataKey="opened" stroke="#f97316" fill="url(#gradOpened)" strokeWidth={2} />
                <Area type="monotone" dataKey="resolved" stroke="#22c55e" fill="url(#gradResolved)" strokeWidth={2} />
                <Area type="monotone" dataKey="critical" stroke="#ef4444" fill="url(#gradCritical)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Severity Distribution */}
        <div className="card animate-in">
          <div className="card-header">
            <span className="card-title">Severity Distribution</span>
          </div>
          <div className="chart-container" style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={severityDistribution}
                  cx="50%" cy="50%"
                  innerRadius={60} outerRadius={90}
                  paddingAngle={4}
                  dataKey="value"
                  stroke="none"
                >
                  {severityDistribution.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#1e2030', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, color: '#f1f5f9', fontSize: 13,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, paddingBottom: 16 }}>
            {severityDistribution.map(s => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: '#94a3b8' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                {s.name}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity + Critical Bugs */}
      <div className="charts-grid">
        {/* Activity Feed */}
        <div className="card animate-in">
          <div className="card-header">
            <span className="card-title">Recent Activity</span>
            <button className="btn-ghost" style={{ fontSize: '0.78rem' }}>View All <ArrowRight size={13} /></button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {MOCK_ACTIVITY.map((act, i) => (
              <div key={act.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 22px',
                borderBottom: i < MOCK_ACTIVITY.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-hover)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {act.actor.includes('AI') ? <Zap size={14} style={{ color: 'var(--accent-primary)' }} /> :
                   act.actor.includes('System') ? <Activity size={14} style={{ color: 'var(--severity-medium)' }} /> :
                   <span style={{ fontSize: '0.65rem', fontWeight: 600 }}>{act.actor.split(' ').map(w=>w[0]).join('')}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                    <strong>{act.actor}</strong>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {act.action}
                  </div>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  <Clock size={11} style={{ marginRight: 3, verticalAlign: -1 }} />
                  {act.time}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Critical Bugs */}
        <div className="card animate-in">
          <div className="card-header">
            <span className="card-title">🔴 Critical Bugs</span>
            <button className="btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => navigate('/bugs')}>
              View All <ArrowRight size={13} />
            </button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {MOCK_BUGS.filter(b => b.severity === 'critical' || b.severity === 'high')
              .filter(b => !['resolved', 'closed'].includes(b.status))
              .map((bug, i) => (
                <div
                  key={bug.id}
                  onClick={() => navigate(`/bugs/${bug.id}`)}
                  style={{
                    padding: '14px 22px', cursor: 'pointer',
                    borderBottom: '1px solid var(--border-subtle)',
                    transition: 'background 150ms',
                  }}
                  onMouseOver={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span className="bug-id">{bug.externalId}</span>
                    <span className={`severity-badge ${bug.severity}`}>{bug.severity}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                    {bug.title.length > 60 ? bug.title.slice(0, 60) + '...' : bug.title}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {bug.assignee ? `→ ${bug.assignee.name}` : 'Unassigned'} • {bug.team}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}
