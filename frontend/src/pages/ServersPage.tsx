import { useState, useEffect } from 'react';
import { listServers, addServer, toggleServer, removeServer, getCurrentUser } from '../api';

export default function ServersPage() {
  const [servers, setServers] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const user = getCurrentUser();
  const isAdmin = user?.role === 'admin';

  // Add form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState('none');
  const [authHeaderName, setAuthHeaderName] = useState('');
  const [authCredential, setAuthCredential] = useState('');

  const fetchServers = async () => {
    try {
      const data = await listServers();
      setServers(data.servers || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchServers(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await addServer({ name, slug, url, auth_type: authType, auth_header_name: authHeaderName, auth_credential: authCredential });
      setShowAdd(false);
      setName(''); setSlug(''); setUrl(''); setAuthType('none'); setAuthHeaderName(''); setAuthCredential('');
      await fetchServers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggle = async (id: number) => {
    try {
      await toggleServer(id);
      await fetchServers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRemove = async (id: number, serverName: string) => {
    if (!confirm(`Remove "${serverName}"? This will disconnect it from the gateway.`)) return;
    try {
      await removeServer(id);
      await fetchServers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" />Loading servers...</div>;

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>MCP Servers</h2>
          <p>Manage upstream MCP servers connected to the gateway</p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Server</button>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="cards-grid">
        {servers.map((server: any) => (
          <div className="card" key={server.id}>
            <div className="card-header">
              <div>
                <h3>{server.name}</h3>
                <span className="mono" style={{ fontSize: 11 }}>{server.slug}</span>
              </div>
              <span className={`badge badge-${server.status}`}>
                <span className={`status-dot ${server.status}`} />
                {server.status}
              </span>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
              {server.url}
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              Auth: {server.auth_type === 'none' ? 'None' : `${server.auth_type} ${server.has_credential ? '(configured)' : '(empty)'}`}
            </p>

            {server.tools?.length > 0 && (
              <div className="tool-list">
                {server.tools.map((t: any) => (
                  <span key={t.name} className="tool-pill" title={t.description}>{t.originalName}</span>
                ))}
              </div>
            )}

            {isAdmin && (
              <div className="btn-group" style={{ marginTop: 16 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => handleToggle(server.id)}>
                  {server.enabled ? '⏸ Disable' : '▶ Enable'}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => handleRemove(server.id, server.name)}>
                  🗑 Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {servers.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🔌</div>
          <p>No MCP servers registered yet.</p>
        </div>
      )}

      {/* Add Server Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleAdd}>
            <h3>Add MCP Server</h3>

            <div className="form-group">
              <label>Server Name</label>
              <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My CRM" required />
            </div>
            <div className="form-group">
              <label>Slug (unique identifier)</label>
              <input className="form-input" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="e.g. my-crm" required />
            </div>
            <div className="form-group">
              <label>URL</label>
              <input className="form-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://service:8000" required />
            </div>
            <div className="form-group">
              <label>Auth Type</label>
              <select className="form-select" value={authType} onChange={(e) => setAuthType(e.target.value)}>
                <option value="none">None</option>
                <option value="bearer">Bearer Token</option>
                <option value="header">Custom Header</option>
              </select>
            </div>
            {authType === 'header' && (
              <div className="form-group">
                <label>Header Name</label>
                <input className="form-input" value={authHeaderName} onChange={(e) => setAuthHeaderName(e.target.value)} placeholder="X-API-Key" />
              </div>
            )}
            {authType !== 'none' && (
              <div className="form-group">
                <label>Credential</label>
                <input className="form-input" type="password" value={authCredential} onChange={(e) => setAuthCredential(e.target.value)} placeholder="Secret token or API key" />
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Add Server</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
