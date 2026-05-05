import { useState } from 'react'
import {
  Settings as SettingsIcon, Bell, Palette, Globe, Key,
  Database, Plug, Save, Check, RotateCcw, Moon, Sun,
  Server, Mail, Shield, Zap
} from 'lucide-react'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general')
  const [saved, setSaved] = useState(false)

  const [settings, setSettings] = useState({
    // General
    orgName: 'eBug Labs',
    orgSlug: 'ebug-labs',
    timezone: 'UTC',
    dateFormat: 'YYYY-MM-DD',

    // Notifications
    emailNotifs: true,
    slackNotifs: false,
    webhookUrl: '',
    notifyCritical: true,
    notifyAssigned: true,
    notifyResolved: false,

    // AI Pipeline
    autoTriage: true,
    minSeverityForLLM: 'medium',
    dedupThreshold: 0.92,
    llmProvider: 'openai',
    llmModel: 'gpt-4o',

    // Integrations
    natsUrl: 'nats://localhost:4222',
    dbUrl: 'postgres://ebug:ebug@localhost:5432/ebug',
    vectorDbUrl: 'http://localhost:19530',
    s3Endpoint: 'http://localhost:9000',
  })

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const update = (key, value) => setSettings(prev => ({ ...prev, [key]: value }))

  const tabs = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'ai', label: 'AI Pipeline', icon: Zap },
    { id: 'integrations', label: 'Integrations', icon: Plug },
  ]

  const ToggleSwitch = ({ checked, onChange }) => (
    <div onClick={() => onChange(!checked)} style={{
      width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
      background: checked ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
      border: `1px solid ${checked ? 'var(--accent-primary)' : 'var(--border-primary)'}`,
      position: 'relative', transition: 'all 0.2s',
    }}>
      <div style={{
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 2,
        left: checked ? 20 : 2, transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  )

  const SettingRow = ({ label, description, children }) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '14px 0', borderBottom: '1px solid var(--border-primary)',
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{description}</div>}
      </div>
      {children}
    </div>
  )

  const InputField = ({ value, onChange, type = 'text', placeholder }) => (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        padding: '8px 12px', borderRadius: 6, fontSize: 13,
        border: '1px solid var(--border-primary)',
        background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
        width: 260, outline: 'none',
      }}
    />
  )

  const SelectField = ({ value, onChange, options }) => (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      padding: '8px 12px', borderRadius: 6, fontSize: 13,
      border: '1px solid var(--border-primary)',
      background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
      minWidth: 180, outline: 'none',
    }}>
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Settings</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Configure your eBug Tracking instance
          </p>
        </div>
        <button className="btn-primary" onClick={handleSave} style={{ fontSize: 12 }}>
          {saved ? <><Check size={14} /> Saved!</> : <><Save size={14} /> Save Changes</>}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>
        {/* Sidebar Tabs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
              background: activeTab === tab.id ? 'var(--accent-primary)' : 'transparent',
              color: activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.id ? 600 : 400,
              transition: 'all 0.15s',
            }}>
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Settings Content */}
        <div className="card" style={{ padding: '4px 24px 24px' }}>
          {activeTab === 'general' && (
            <>
              <h4 style={{ color: 'var(--text-primary)', fontSize: 15, margin: '20px 0 4px' }}>General Settings</h4>
              <SettingRow label="Organization Name" description="Your org display name">
                <InputField value={settings.orgName} onChange={v => update('orgName', v)} />
              </SettingRow>
              <SettingRow label="Organization Slug" description="URL identifier">
                <InputField value={settings.orgSlug} onChange={v => update('orgSlug', v)} />
              </SettingRow>
              <SettingRow label="Timezone">
                <SelectField value={settings.timezone} onChange={v => update('timezone', v)} options={[
                  { value: 'UTC', label: 'UTC' },
                  { value: 'America/New_York', label: 'Eastern (US)' },
                  { value: 'America/Los_Angeles', label: 'Pacific (US)' },
                  { value: 'Europe/London', label: 'London' },
                  { value: 'Asia/Kolkata', label: 'India (IST)' },
                  { value: 'Asia/Tokyo', label: 'Tokyo' },
                ]} />
              </SettingRow>
              <SettingRow label="Date Format">
                <SelectField value={settings.dateFormat} onChange={v => update('dateFormat', v)} options={[
                  { value: 'YYYY-MM-DD', label: '2026-05-05' },
                  { value: 'MM/DD/YYYY', label: '05/05/2026' },
                  { value: 'DD/MM/YYYY', label: '05/05/2026' },
                ]} />
              </SettingRow>
            </>
          )}

          {activeTab === 'notifications' && (
            <>
              <h4 style={{ color: 'var(--text-primary)', fontSize: 15, margin: '20px 0 4px' }}>Notification Settings</h4>
              <SettingRow label="Email Notifications" description="Receive bug alerts via email">
                <ToggleSwitch checked={settings.emailNotifs} onChange={v => update('emailNotifs', v)} />
              </SettingRow>
              <SettingRow label="Slack Integration" description="Post alerts to Slack channel">
                <ToggleSwitch checked={settings.slackNotifs} onChange={v => update('slackNotifs', v)} />
              </SettingRow>
              <SettingRow label="Webhook URL" description="POST notifications to custom endpoint">
                <InputField value={settings.webhookUrl} onChange={v => update('webhookUrl', v)} placeholder="https://..." />
              </SettingRow>
              <SettingRow label="Notify on Critical" description="Immediate alerts for critical severity">
                <ToggleSwitch checked={settings.notifyCritical} onChange={v => update('notifyCritical', v)} />
              </SettingRow>
              <SettingRow label="Notify on Assignment" description="Alert when a bug is assigned to you">
                <ToggleSwitch checked={settings.notifyAssigned} onChange={v => update('notifyAssigned', v)} />
              </SettingRow>
              <SettingRow label="Notify on Resolution" description="Alert when assigned bugs are resolved">
                <ToggleSwitch checked={settings.notifyResolved} onChange={v => update('notifyResolved', v)} />
              </SettingRow>
            </>
          )}

          {activeTab === 'ai' && (
            <>
              <h4 style={{ color: 'var(--text-primary)', fontSize: 15, margin: '20px 0 4px' }}>AI Pipeline Configuration</h4>
              <SettingRow label="Auto-Triage" description="Automatically run severity scoring and root cause analysis">
                <ToggleSwitch checked={settings.autoTriage} onChange={v => update('autoTriage', v)} />
              </SettingRow>
              <SettingRow label="Min Severity for LLM" description="Only use LLM for bugs at or above this severity">
                <SelectField value={settings.minSeverityForLLM} onChange={v => update('minSeverityForLLM', v)} options={[
                  { value: 'info', label: 'Info (all bugs)' },
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                  { value: 'critical', label: 'Critical only' },
                ]} />
              </SettingRow>
              <SettingRow label="Dedup Threshold" description="Cosine similarity threshold for duplicate detection">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="range" min="0.70" max="0.99" step="0.01"
                    value={settings.dedupThreshold}
                    onChange={e => update('dedupThreshold', parseFloat(e.target.value))}
                    style={{ width: 160, accentColor: 'var(--accent-primary)' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: 'var(--accent-primary)' }}>
                    {(settings.dedupThreshold * 100).toFixed(0)}%
                  </span>
                </div>
              </SettingRow>
              <SettingRow label="LLM Provider">
                <SelectField value={settings.llmProvider} onChange={v => update('llmProvider', v)} options={[
                  { value: 'openai', label: 'OpenAI' },
                  { value: 'anthropic', label: 'Anthropic Claude' },
                  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
                ]} />
              </SettingRow>
              <SettingRow label="LLM Model">
                <SelectField value={settings.llmModel} onChange={v => update('llmModel', v)} options={[
                  { value: 'gpt-4o', label: 'GPT-4o' },
                  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
                  { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
                  { value: 'claude-3-opus', label: 'Claude 3 Opus' },
                ]} />
              </SettingRow>
            </>
          )}

          {activeTab === 'integrations' && (
            <>
              <h4 style={{ color: 'var(--text-primary)', fontSize: 15, margin: '20px 0 4px' }}>Infrastructure</h4>
              <SettingRow label="NATS JetStream URL" description="Event bus connection">
                <InputField value={settings.natsUrl} onChange={v => update('natsUrl', v)} />
              </SettingRow>
              <SettingRow label="PostgreSQL URL" description="Primary database">
                <InputField value={settings.dbUrl} onChange={v => update('dbUrl', v)} />
              </SettingRow>
              <SettingRow label="Milvus / Vector DB URL" description="For embedding similarity search">
                <InputField value={settings.vectorDbUrl} onChange={v => update('vectorDbUrl', v)} />
              </SettingRow>
              <SettingRow label="S3 / MinIO Endpoint" description="Object storage for logs and screenshots">
                <InputField value={settings.s3Endpoint} onChange={v => update('s3Endpoint', v)} />
              </SettingRow>

              {/* Connection Status */}
              <h4 style={{ color: 'var(--text-primary)', fontSize: 15, margin: '24px 0 12px' }}>Connection Status</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { name: 'PostgreSQL', status: 'connected', icon: Database },
                  { name: 'NATS JetStream', status: 'connected', icon: Server },
                  { name: 'Milvus', status: 'connected', icon: Globe },
                  { name: 'MinIO (S3)', status: 'connected', icon: Shield },
                ].map(svc => (
                  <div key={svc.name} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                    background: 'var(--bg-tertiary)', borderRadius: 8,
                  }}>
                    <svc.icon size={16} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{svc.name}</span>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: svc.status === 'connected' ? 'var(--severity-info)' : 'var(--severity-critical)',
                    }} />
                    <span style={{ fontSize: 11, color: svc.status === 'connected' ? 'var(--severity-info)' : 'var(--severity-critical)' }}>
                      {svc.status}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
