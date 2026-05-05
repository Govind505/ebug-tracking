import { useState } from 'react'
import { Users, UserPlus, Settings, Bug, Shield, Mail, MoreVertical, Search } from 'lucide-react'
import { MOCK_BUGS } from '../data/mockData.js'

export default function Teams() {
  const [selectedTeam, setSelectedTeam] = useState(null)

  const teams = [
    {
      id: 'c0000000-0000-0000-0000-000000000001',
      name: 'Core Platform',
      description: 'Backend services, APIs, and infrastructure',
      members: [
        { id: 'm1', name: 'Admin User', email: 'admin@ebug.dev', role: 'Lead', avatar: 'AU', activeBugs: 4 },
        { id: 'm2', name: 'Developer One', email: 'dev1@ebug.dev', role: 'Senior Dev', avatar: 'DO', activeBugs: 6 },
        { id: 'm3', name: 'Sarah Chen', email: 'sarah@ebug.dev', role: 'Backend Dev', avatar: 'SC', activeBugs: 3 },
      ],
      routingRules: ['services/*', 'packages/*', 'proto/*'],
      bugCount: Math.floor(MOCK_BUGS.length * 0.6),
      color: '#3b82f6',
    },
    {
      id: 'c0000000-0000-0000-0000-000000000002',
      name: 'Frontend',
      description: 'Dashboard, plugins, and UI components',
      members: [
        { id: 'm4', name: 'Alex Kim', email: 'alex@ebug.dev', role: 'Lead', avatar: 'AK', activeBugs: 5 },
        { id: 'm5', name: 'Maria Garcia', email: 'maria@ebug.dev', role: 'Frontend Dev', avatar: 'MG', activeBugs: 2 },
      ],
      routingRules: ['apps/*', 'plugins/*'],
      bugCount: Math.floor(MOCK_BUGS.length * 0.3),
      color: '#8b5cf6',
    },
    {
      id: 't3',
      name: 'AI / ML',
      description: 'AI triage pipeline, severity scoring, root cause analysis',
      members: [
        { id: 'm6', name: 'James Liu', email: 'james@ebug.dev', role: 'ML Engineer', avatar: 'JL', activeBugs: 1 },
      ],
      routingRules: ['services/dedup-engine/*', 'services/severity-scorer/*', 'services/root-cause-analyzer/*'],
      bugCount: Math.floor(MOCK_BUGS.length * 0.1),
      color: '#f59e0b',
    },
  ]

  const active = selectedTeam ? teams.find(t => t.id === selectedTeam) : null

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Teams</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            {teams.length} teams · {teams.reduce((s, t) => s + t.members.length, 0)} members
          </p>
        </div>
        <button className="btn-primary" style={{ fontSize: 12 }}>
          <UserPlus size={14} /> Create Team
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 16 }}>
        {/* Team List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {teams.map(team => (
            <div key={team.id}
              className="card"
              onClick={() => setSelectedTeam(team.id)}
              style={{
                padding: 16, cursor: 'pointer',
                border: selectedTeam === team.id ? `2px solid ${team.color}` : '2px solid transparent',
                transition: 'border-color 0.15s, transform 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: `${team.color}20`, color: team.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 700,
                }}>
                  {team.name.charAt(0)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{team.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{team.description}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Users size={12} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{team.members.length}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Bug size={12} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{team.bugCount} bugs</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Team Detail */}
        {active ? (
          <div className="card" style={{ padding: 0 }}>
            {/* Team Header */}
            <div style={{
              padding: '20px 24px', borderBottom: '1px solid var(--border-primary)',
              background: `linear-gradient(135deg, ${active.color}08, ${active.color}03)`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h4 style={{ margin: '0 0 4px', color: 'var(--text-primary)' }}>{active.name}</h4>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{active.description}</p>
                </div>
                <button className="btn-ghost" style={{ padding: 6 }}><Settings size={16} /></button>
              </div>
            </div>

            {/* Members */}
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h5 style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Members ({active.members.length})
                </h5>
                <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 11 }}>
                  <UserPlus size={12} /> Add
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {active.members.map(member => (
                  <div key={member.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    background: 'var(--bg-tertiary)', borderRadius: 8,
                  }}>
                    <div className="avatar" style={{ width: 32, height: 32, fontSize: 11 }}>{member.avatar}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{member.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{member.email}</div>
                    </div>
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 4,
                      background: member.role === 'Lead' ? `${active.color}15` : 'var(--bg-secondary)',
                      color: member.role === 'Lead' ? active.color : 'var(--text-muted)',
                      fontWeight: 600,
                    }}>{member.role}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Bug size={12} style={{ color: 'var(--text-muted)' }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{member.activeBugs}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Routing Rules */}
            <div style={{ padding: '16px 24px' }}>
              <h5 style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Auto-Routing Rules
              </h5>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-secondary)' }}>
                Bugs matching these file patterns are automatically assigned to this team:
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {active.routingRules.map(rule => (
                  <code key={rule} style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 4,
                    background: 'var(--bg-tertiary)', color: 'var(--accent-primary)',
                    border: '1px solid var(--border-primary)',
                  }}>{rule}</code>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              <Users size={40} style={{ opacity: 0.2, marginBottom: 12 }} />
              <p style={{ fontSize: 13, margin: 0 }}>Select a team to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
