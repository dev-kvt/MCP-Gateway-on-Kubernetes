import { useState, useEffect } from 'react';
import { listKeys, generateKey, revokeKey } from '../api';

export default function KeysPage() {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');

  const fetchKeys = async () => {
    try {
      const data = await listKeys();
      setKeys(data.keys || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchKeys(); }, []);

  const handleGenerate = async () => {
    setError('');
    try {
      const data = await generateKey(label);
      setNewKey(data.key);
      setLabel('');
      await fetchKeys();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRevoke = async (id: number) => {
    if (!confirm('Revoke this API key? This action cannot be undone.')) return;
    try {
      await revokeKey(id);
      await fetchKeys();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" />Loading keys...</div>;

  return (
    <>
      <div className="page-header">
        <h2>API Keys</h2>
        <p>Generate and manage your personal API keys for the MCP gateway endpoint</p>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {newKey && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--accent)' }}>
          <h3 style={{ marginBottom: 8 }}>🔑 New API Key Generated</h3>
          <div className="key-display" onClick={copyKey} style={{ cursor: 'pointer' }}>
            {newKey}
            <span className="copy-hint">⚠️ Copy this key now — it won't be shown again. Click to copy.</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Use this key in your MCP client: <span className="mono">Authorization: Bearer {'{'}your-key{'}'}</span>
          </p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setNewKey(null)}>Dismiss</button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Generate New Key</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label>Label (optional)</label>
            <input className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Claude Code, Cursor, Testing" />
          </div>
          <button className="btn btn-primary" onClick={handleGenerate}>Generate Key</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Prefix</th>
              <th>Label</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No API keys yet</td></tr>
            ) : keys.map((key: any) => (
              <tr key={key.id}>
                <td><span className="mono">{key.key_prefix}...</span></td>
                <td>{key.label || '—'}</td>
                <td>
                  <span className={`badge ${key.revoked ? 'badge-error' : 'badge-success'}`}>
                    {key.revoked ? 'Revoked' : 'Active'}
                  </span>
                </td>
                <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {new Date(key.created_at + 'Z').toLocaleString()}
                </td>
                <td>
                  {!key.revoked && (
                    <button className="btn btn-danger btn-sm" onClick={() => handleRevoke(key.id)}>Revoke</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
