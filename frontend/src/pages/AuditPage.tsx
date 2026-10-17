import { useState, useEffect } from 'react';
import { listAudit } from '../api';

export default function AuditPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const LIMIT = 50;

  const fetchAudit = async (offset: number) => {
    setLoading(true);
    try {
      const data = await listAudit(LIMIT, offset);
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAudit(page * LIMIT); }, [page]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Audit Log</h2>
          <p>Complete record of every tool call through the gateway</p>
        </div>
        <button className="btn btn-ghost" onClick={() => fetchAudit(page * LIMIT)}>↻ Refresh</button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />Loading audit log...</div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User</th>
                  <th>Server</th>
                  <th>Tool</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Error</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 48 }}>No audit entries yet. Tool calls will appear here.</td></tr>
                ) : entries.map((e: any) => (
                  <tr key={e.id}>
                    <td style={{ color: 'var(--text-muted)' }}>#{e.id}</td>
                    <td style={{ fontWeight: 600 }}>{e.username}</td>
                    <td><span className="mono">{e.server_slug}</span></td>
                    <td><span className="mono">{e.tool_name}</span></td>
                    <td>{e.duration_ms}ms</td>
                    <td>
                      <span className={`badge ${e.success ? 'badge-success' : 'badge-error'}`}>
                        {e.success ? '✓ OK' : '✗ Fail'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--danger)', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.error_message || '—'}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(e.created_at + 'Z').toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
              <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button>
              <span style={{ padding: '6px 12px', fontSize: 13, color: 'var(--text-muted)' }}>
                Page {page + 1} of {totalPages} ({total} total)
              </span>
              <button className="btn btn-ghost btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
