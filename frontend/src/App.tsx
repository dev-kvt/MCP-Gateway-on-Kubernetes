import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { isLoggedIn, getCurrentUser, logout } from './api';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ServersPage from './pages/ServersPage';
import UsersPage from './pages/UsersPage';
import AuditPage from './pages/AuditPage';
import ChatPage from './pages/ChatPage';
import KeysPage from './pages/KeysPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Layout({ children }: { children: React.ReactNode }) {
  const user = getCurrentUser();
  const location = useLocation();

  const navItems = [
    { to: '/', icon: '📊', label: 'Dashboard' },
    { to: '/servers', icon: '🔌', label: 'MCP Servers' },
    { to: '/keys', icon: '🔑', label: 'API Keys' },
    ...(user?.role === 'admin' ? [{ to: '/users', icon: '👥', label: 'Team' }] : []),
    { to: '/audit', icon: '📋', label: 'Audit Log' },
    { to: '/chat', icon: '💬', label: 'Chat Agent' },
  ];

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>⚡ Urumi Gateway</h1>
          <p>MCP Control Plane</p>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => isActive ? 'active' : ''}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            <span className="user-name">{user?.username}</span>
            <span className="user-role">{user?.role}</span>
          </div>
          <button className="logout-btn" onClick={logout} title="Logout">⏻</button>
        </div>
      </aside>
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Layout><DashboardPage /></Layout></ProtectedRoute>} />
      <Route path="/servers" element={<ProtectedRoute><Layout><ServersPage /></Layout></ProtectedRoute>} />
      <Route path="/keys" element={<ProtectedRoute><Layout><KeysPage /></Layout></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute><Layout><UsersPage /></Layout></ProtectedRoute>} />
      <Route path="/audit" element={<ProtectedRoute><Layout><AuditPage /></Layout></ProtectedRoute>} />
      <Route path="/chat" element={<ProtectedRoute><Layout><ChatPage /></Layout></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
