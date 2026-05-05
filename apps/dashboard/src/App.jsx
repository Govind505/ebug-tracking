import { useState } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import {
  Bug, LayoutDashboard, BarChart3, Users, Settings,
  Search, Bell, Zap, Shield, Clock, Layers
} from 'lucide-react'
import Dashboard from './pages/Dashboard.jsx'
import BugList from './pages/BugList.jsx'
import BugDetail from './pages/BugDetail.jsx'
import Analytics from './pages/Analytics.jsx'
import AITriage from './pages/AITriage.jsx'
import Deduplication from './pages/Deduplication.jsx'
import Teams from './pages/Teams.jsx'
import Security from './pages/Security.jsx'
import SettingsPage from './pages/Settings.jsx'
import { MOCK_BUGS } from './data/mockData.js'

export default function App() {
  const location = useLocation()
  const criticalCount = MOCK_BUGS.filter(b => b.severity === 'critical' && b.status !== 'resolved' && b.status !== 'closed').length

  const getPageTitle = () => {
    if (location.pathname === '/') return 'Dashboard'
    if (location.pathname === '/bugs') return 'Bug Reports'
    if (location.pathname.startsWith('/bugs/')) return 'Bug Detail'
    if (location.pathname === '/analytics') return 'Analytics'
    if (location.pathname === '/ai-triage') return 'AI Triage'
    if (location.pathname === '/dedup') return 'Deduplication'
    if (location.pathname === '/teams') return 'Teams'
    if (location.pathname === '/security') return 'Security'
    if (location.pathname === '/settings') return 'Settings'
    return 'eBug Tracking'
  }

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">eB</div>
          <div>
            <h1>eBug Tracking</h1>
            <span>Universal Quality Fabric</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-title">Overview</div>
          <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <LayoutDashboard size={17} />
            Dashboard
          </NavLink>
          <NavLink to="/bugs" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <Bug size={17} />
            Bug Reports
            {criticalCount > 0 && <span className="badge">{criticalCount}</span>}
          </NavLink>

          <div className="sidebar-section-title">Intelligence</div>
          <NavLink to="/analytics" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <BarChart3 size={17} />
            Analytics
          </NavLink>
          <NavLink to="/ai-triage" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <Zap size={17} />
            AI Triage
          </NavLink>
          <NavLink to="/dedup" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <Layers size={17} />
            Deduplication
          </NavLink>

          <div className="sidebar-section-title">Management</div>
          <NavLink to="/teams" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <Users size={17} />
            Teams
          </NavLink>
          <NavLink to="/security" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <Shield size={17} />
            Security
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <Settings size={17} />
            Settings
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="sync-status">
            <div className="sync-dot"></div>
            <span>Cloud Sync Active</span>
            <Clock size={12} style={{ marginLeft: 'auto' }} />
            <span>2s ago</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="header">
          <h2 className="header-title">{getPageTitle()}</h2>
          <div className="header-actions">
            <div className="header-search">
              <Search className="search-icon" size={15} />
              <input type="text" placeholder="Search bugs, files, teams..." />
            </div>
            <button className="btn-ghost" style={{ position: 'relative' }}>
              <Bell size={18} />
              <span style={{
                position: 'absolute', top: 2, right: 2, width: 7, height: 7,
                background: 'var(--severity-critical)', borderRadius: '50%',
                border: '2px solid var(--bg-primary)'
              }} />
            </button>
            <div className="avatar">AU</div>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/bugs" element={<BugList />} />
          <Route path="/bugs/:id" element={<BugDetail />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/ai-triage" element={<AITriage />} />
          <Route path="/dedup" element={<Deduplication />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/security" element={<Security />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={
            <div className="page">
              <div className="empty-state">
                <Layers className="empty-state-icon" size={64} />
                <h3 className="empty-state-title">Page Not Found</h3>
                <p className="empty-state-text">The page you're looking for doesn't exist.</p>
              </div>
            </div>
          } />
        </Routes>
      </main>
    </div>
  )
}
