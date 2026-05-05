import { useState } from 'react'
import {
  Shield, AlertTriangle, CheckCircle, Lock, Unlock,
  Eye, EyeOff, Key, Globe, Server, Clock, Info
} from 'lucide-react'
import { MOCK_BUGS } from '../data/mockData.js'

export default function Security() {
  const securityBugs = MOCK_BUGS.filter(b => b.category === 'security')
  const criticalSec = securityBugs.filter(b => b.severity === 'critical')
  const openSec = securityBugs.filter(b => !['resolved', 'closed'].includes(b.status))

  const vulnTypes = [
    { type: 'SQL Injection', count: 2, severity: 'critical', status: 'mitigated', icon: '💉' },
    { type: 'XSS (Cross-Site Scripting)', count: 1, severity: 'high', status: 'open', icon: '🖥️' },
    { type: 'Auth Bypass', count: 1, severity: 'critical', status: 'mitigated', icon: '🔓' },
    { type: 'CSRF Token Missing', count: 3, severity: 'medium', status: 'patched', icon: '🔑' },
    { type: 'Sensitive Data Exposure', count: 1, severity: 'high', status: 'open', icon: '👁️' },
    { type: 'Dependency Vulnerability', count: 4, severity: 'medium', status: 'monitoring', icon: '📦' },
  ]

  const complianceChecks = [
    { name: 'OWASP Top 10 Coverage', status: 'pass', score: 92 },
    { name: 'Dependency Audit (npm audit)', status: 'warn', score: 78 },
    { name: 'Secret Scanning', status: 'pass', score: 100 },
    { name: 'Container Image Scanning', status: 'pass', score: 95 },
    { name: 'API Rate Limiting', status: 'fail', score: 40 },
    { name: 'Input Validation Coverage', status: 'warn', score: 72 },
  ]

  const severityColors = {
    critical: 'var(--severity-critical)', high: 'var(--severity-high)',
    medium: 'var(--severity-medium)', low: 'var(--severity-low)',
  }

  return (
    <div className="page">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Security Overview</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Vulnerability tracking and compliance monitoring
        </p>
      </div>

      {/* Security Stats */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Security Bugs</span>
            <Shield size={16} style={{ color: 'var(--severity-high)' }} />
          </div>
          <div className="stat-value">{securityBugs.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Critical Vulns</span>
            <AlertTriangle size={16} style={{ color: 'var(--severity-critical)' }} />
          </div>
          <div className="stat-value" style={{ color: criticalSec.length > 0 ? 'var(--severity-critical)' : 'var(--text-primary)' }}>
            {criticalSec.length}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Open Issues</span>
            <Unlock size={16} style={{ color: 'var(--severity-medium)' }} />
          </div>
          <div className="stat-value">{openSec.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Security Score</span>
            <Lock size={16} style={{ color: 'var(--severity-info)' }} />
          </div>
          <div className="stat-value" style={{ color: 'var(--severity-info)' }}>B+</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Vulnerability Types */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)' }}>
            <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 14 }}>Vulnerability Types</h4>
          </div>
          <div>
            {vulnTypes.map((vuln, i) => (
              <div key={i} style={{
                padding: '12px 20px', borderBottom: i < vulnTypes.length - 1 ? '1px solid var(--border-primary)' : 'none',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span style={{ fontSize: 18 }}>{vuln.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{vuln.type}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                    <span className={`severity-badge severity-${vuln.severity}`}>{vuln.severity}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{vuln.count} instances</span>
                  </div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                  textTransform: 'uppercase',
                  background: vuln.status === 'patched' || vuln.status === 'mitigated'
                    ? 'rgba(16,185,129,0.1)' : vuln.status === 'open'
                    ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                  color: vuln.status === 'patched' || vuln.status === 'mitigated'
                    ? 'var(--severity-info)' : vuln.status === 'open'
                    ? 'var(--severity-critical)' : 'var(--severity-medium)',
                }}>{vuln.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Compliance Checks */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)' }}>
            <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 14 }}>Compliance Checks</h4>
          </div>
          <div>
            {complianceChecks.map((check, i) => (
              <div key={i} style={{
                padding: '12px 20px', borderBottom: i < complianceChecks.length - 1 ? '1px solid var(--border-primary)' : 'none',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                {check.status === 'pass' ? (
                  <CheckCircle size={16} style={{ color: 'var(--severity-info)', flexShrink: 0 }} />
                ) : check.status === 'warn' ? (
                  <AlertTriangle size={16} style={{ color: 'var(--severity-medium)', flexShrink: 0 }} />
                ) : (
                  <AlertTriangle size={16} style={{ color: 'var(--severity-critical)', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{check.name}</div>
                </div>
                <div style={{ width: 80 }}>
                  <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3 }}>
                    <div style={{
                      width: `${check.score}%`, height: '100%', borderRadius: 3,
                      background: check.score > 85 ? 'var(--severity-info)'
                        : check.score > 60 ? 'var(--severity-medium)' : 'var(--severity-critical)',
                    }} />
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', width: 32, textAlign: 'right' }}>
                  {check.score}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Security Advisories */}
      <div className="card" style={{ padding: 20 }}>
        <h4 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: 14 }}>
          🔐 Security Advisories
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { title: 'CVE-2026-1234: express < 4.19.2 — Prototype pollution', severity: 'high', age: '3 days ago' },
            { title: 'CVE-2026-5678: pg < 8.12.1 — SQL injection in parameterized queries', severity: 'critical', age: '1 day ago' },
            { title: 'GHSA-xxxx: nats.js — Denial of service via malformed message', severity: 'medium', age: '5 days ago' },
          ].map((advisory, i) => (
            <div key={i} style={{
              padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: 8,
              borderLeft: `3px solid ${severityColors[advisory.severity]}`,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <AlertTriangle size={14} style={{ color: severityColors[advisory.severity], flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{advisory.title}</div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{advisory.age}</span>
              <span className={`severity-badge severity-${advisory.severity}`}>{advisory.severity}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
