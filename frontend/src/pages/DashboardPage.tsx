import { useState, useEffect } from 'react';
import { listServers, listAudit } from '../api';

export default function DashboardPage() {
  const [servers, setServers] = useState<any[]>([]);
  const [recentAudit, setRecentAudit] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listServers(), listAudit(10)]).then(([s, a]) => {
      setServers(s.servers || []);
      setRecentAudit(a.entries || []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading"><div className="spinner" />Loading dashboard...</div>;

  const connected = servers.filter((s) => s.status === 'connected').length;
  const totalTools = servers.reduce((sum: number, s: any) => sum + (s.tools?.length || 0), 0);

  return (
    <>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Overview of your MCP Gateway platform</p>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{servers.length}</div>
          <div className="stat-label">MCP Servers</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{connected}</div>
          <div className="stat-label">Connected</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalTools}</div>
          <div className="stat-label">Available Tools</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{recentAudit.length}</div>
          <div className="stat-label">Recent Calls</div>
        </div>
      </div>

      <div className="cards-grid">
        {servers.map((server: any) => (
          <div className="card" key={server.id}>
            <div className="card-header">
              <h3>{server.name}</h3>
              <span className={`badge badge-${server.status}`}>
                <span className={`status-dot ${server.status}`} />
                {server.status}
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 4 }}>
              <span className="mono">{server.slug}</span> &middot; {server.url}
            </p>
            {server.tools?.length > 0 && (
              <div className="tool-list">
                {server.tools.map((t: any) => (
                  <span key={t.name} className="tool-pill">{t.originalName}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {recentAudit.length > 0 && (
        <>
          <div className="page-header" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 18 }}>Recent Tool Calls</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Server</th>
                  <th>Tool</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {recentAudit.map((entry: any) => (
                  <tr key={entry.id}>
                    <td>{entry.username}</td>
                    <td><span className="mono">{entry.server_slug}</span></td>
                    <td><span className="mono">{entry.tool_name}</span></td>
                    <td>{entry.duration_ms}ms</td>
                    <td>
                      <span className={`badge ${entry.success ? 'badge-success' : 'badge-error'}`}>
                        {entry.success ? '✓ OK' : '✗ Error'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {new Date(entry.created_at + 'Z').toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
