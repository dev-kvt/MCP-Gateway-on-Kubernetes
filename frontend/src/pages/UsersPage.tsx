import { useState, useEffect } from 'react';
import { listUsers, inviteUser, deleteUser } from '../api';

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [error, setError] = useState('');

  // Invite form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('member');

  const fetchUsers = async () => {
    try {
      const data = await listUsers();
      setUsers(data.users || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await inviteUser(username, password, role);
      setShowInvite(false);
      setUsername(''); setPassword(''); setRole('member');
      await fetchUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Remove user "${name}"? This will also revoke their API keys.`)) return;
    try {
      await deleteUser(id);
      await fetchUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" />Loading users...</div>;

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Team Management</h2>
          <p>Invite team members and manage access roles</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowInvite(true)}>+ Invite Member</button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user: any) => (
              <tr key={user.id}>
                <td style={{ fontWeight: 600 }}>{user.username}</td>
                <td>
                  <span className={`badge badge-${user.role}`}>{user.role}</span>
                </td>
                <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {new Date(user.created_at + 'Z').toLocaleString()}
                </td>
                <td>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(user.id, user.username)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleInvite}>
            <h3>Invite Team Member</h3>

            <div className="form-group">
              <label>Username</label>
              <input className="form-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. jane" required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Temporary password" required minLength={6} />
            </div>
            <div className="form-group">
              <label>Role</label>
              <select className="form-select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowInvite(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Send Invite</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
