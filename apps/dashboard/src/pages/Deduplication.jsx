import { useState, useEffect, useMemo } from 'react'
import { Layers, Link2, Search, Eye, CheckCircle, XCircle } from 'lucide-react'
import { MOCK_BUGS } from '../data/mockData.js'
import api from '../api/client.js'

export default function Deduplication() {
  const [threshold, setThreshold] = useState(0.92)
  const [liveBugs, setLiveBugs] = useState(null)

  // Fetch live bugs from API
  useEffect(() => {
    let cancelled = false
    async function fetchBugs() {
      try {
        const result = await api.listBugs({ limit: 200 })
        if (!cancelled && result?.bugs) setLiveBugs(result.bugs)
      } catch { /* mock fallback */ }
    }
    fetchBugs()
    return () => { cancelled = true }
  }, [])

  const bugs = liveBugs || MOCK_BUGS

  // Build duplicate groups from live data or simulate
  const duplicateGroups = useMemo(() => {
    // Check if we have real duplicate data from API
    const dupes = bugs.filter(b => b.is_duplicate && b.canonical_id)
    if (dupes.length > 0) {
      // Group by canonical_id
      const groups = {}
      dupes.forEach(d => {
        const cid = d.canonical_id
        if (!groups[cid]) {
          const canonical = bugs.find(b => b.id === cid)
          groups[cid] = { canonical: canonical || d, duplicates: [] }
        }
        groups[cid].duplicates.push({
          ...d,
          external_id: d.external_id || d.externalId,
          similarity_score: d.similarity_score || d.similarityScore || 0.93,
        })
      })
      return Object.values(groups)
    }

    // Fallback: simulate duplicate groups from mock data
    return [
      {
        canonical: bugs[0],
        duplicates: [
          { ...bugs[0], id: 'd1', external_id: 'EBUG-0099', title: bugs[0]?.title + ' (variant)', similarity_score: 0.96 },
          { ...bugs[0], id: 'd2', external_id: 'EBUG-0103', title: 'Similar: ' + bugs[0]?.title, similarity_score: 0.93 },
        ],
      },
      ...(bugs.length > 3 ? [{
        canonical: bugs[3],
        duplicates: [
          { ...bugs[3], id: 'd3', external_id: 'EBUG-0115', title: bugs[3]?.title + ' (duplicate)', similarity_score: 0.95 },
        ],
      }] : []),
    ]
  }, [bugs])

  const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.duplicates.length, 0)
  const uniqueBugs = bugs.length - totalDuplicates
  const savedHours = totalDuplicates * 2.5

  return (
    <div className="page">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Deduplication Engine</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Vector similarity deduplication powered by Milvus embeddings
        </p>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Unique Bugs</span>
            <CheckCircle size={16} style={{ color: 'var(--severity-info)' }} />
          </div>
          <div className="stat-value">{uniqueBugs}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Duplicates Found</span>
            <Link2 size={16} style={{ color: 'var(--severity-medium)' }} />
          </div>
          <div className="stat-value">{totalDuplicates}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Duplicate Groups</span>
            <Layers size={16} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div className="stat-value">{duplicateGroups.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Hours Saved</span>
            <span style={{ fontSize: 14 }}>⏱️</span>
          </div>
          <div className="stat-value">{savedHours.toFixed(0)}h</div>
        </div>
      </div>

      {/* Threshold Config */}
      <div className="card" style={{ padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h4 style={{ margin: '0 0 4px', color: 'var(--text-primary)', fontSize: 14 }}>Similarity Threshold</h4>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12 }}>
              Bugs above this cosine similarity score are marked as duplicates
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="range" min="0.70" max="0.99" step="0.01"
              value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
              style={{ width: 200, accentColor: 'var(--accent-primary)' }}
            />
            <span style={{
              fontSize: 18, fontWeight: 700, color: 'var(--accent-primary)',
              background: 'var(--bg-tertiary)', padding: '6px 14px', borderRadius: 8,
              fontFamily: 'monospace', minWidth: 60, textAlign: 'center',
            }}>
              {(threshold * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      {/* Duplicate Groups */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {duplicateGroups.map((group, gi) => (
          <div key={gi} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Canonical Bug */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--border-primary)',
              background: 'var(--bg-secondary)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, color: '#fff', fontWeight: 700,
              }}>C</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 11, color: 'var(--accent-primary)', fontWeight: 600 }}>{group.canonical.external_id}</span>
                  <span className={`severity-badge severity-${group.canonical.severity}`}>{group.canonical.severity}</span>
                  <span style={{ fontSize: 10, background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4, color: 'var(--text-muted)' }}>
                    CANONICAL
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{group.canonical.title}</div>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {group.duplicates.length} duplicate{group.duplicates.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Duplicates */}
            {group.duplicates.map((dup, di) => (
              <div key={di} style={{
                padding: '12px 20px 12px 64px', borderBottom: di < group.duplicates.length - 1 ? '1px solid var(--border-primary)' : 'none',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <Link2 size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dup.external_id}</span>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 4,
                      background: 'rgba(239, 68, 68, 0.1)', color: 'var(--severity-high)',
                    }}>DUPLICATE</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{dup.title}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                    {(dup.similarity_score * 100).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>similarity</div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn-ghost" style={{ padding: 6 }} title="View"><Eye size={14} /></button>
                  <button className="btn-ghost" style={{ padding: 6 }} title="Unlink"><XCircle size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
