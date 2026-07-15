import { useEffect, useState } from 'react';
import { KeyRound, RefreshCw, UserPlus, UserRoundCheck, UserRoundX } from 'lucide-react';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role?: string | string[] | null;
  banned?: boolean | null;
}

export default function UserManagement() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const result = await adminRequest<{ users: ManagedUser[] }>('/api/admin/users');
    setUsers(result.users);
  }

  useEffect(() => { refresh().catch(showError); }, []);

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    try {
      await adminRequest('/api/admin/users', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', email: '', password: '' });
      setMessage('User created.');
      await refresh();
    } catch (error) { showError(error); }
  }

  async function action(userId: string, actionName: string) {
    try {
      await adminRequest(`/api/admin/users/${userId}/${actionName}`, { method: 'POST' });
      setMessage('Account updated.');
      await refresh();
    } catch (error) { showError(error); }
  }

  async function setPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!resetFor) return;
    try {
      await adminRequest(`/api/admin/users/${resetFor}/password`, { method: 'POST', body: JSON.stringify({ password: resetPassword }) });
      setResetFor(null);
      setResetPassword('');
      setMessage('Temporary password set.');
    } catch (error) { showError(error); }
  }

  function showError(error: unknown) { setMessage((error as Error).message); }

  return <section className="workspace-section" aria-labelledby="users-title">
    <div className="section-intro"><div><p className="eyebrow">Administration</p><h2 id="users-title">Manage who can use Birdie.</h2><p>Create accounts, reset passwords, revoke sessions, or disable access. Content permissions remain the same for every enabled user.</p></div><Button variant="outline" size="sm" onClick={() => refresh().catch(showError)}><RefreshCw size={15} />Refresh</Button></div>
    {message && <div className="feedback-message" role="status">{message}</div>}
    <form className="user-create" onSubmit={createUser}>
      <Input aria-label="Name" placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
      <Input aria-label="Email" type="email" placeholder="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
      <Input aria-label="Temporary password" type="password" minLength={12} placeholder="Temporary password (12+ characters)" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
      <Button type="submit"><UserPlus size={16} />Create user</Button>
    </form>
    <div className="user-table">
      {users.map((user) => <div className="user-row" key={user.id}>
        <div className="user-cell"><strong>{user.name}</strong><span>{user.email}</span></div>
        <div className="user-role">{String(user.role ?? 'user')} {user.banned ? '· disabled' : ''}</div>
        <div className="user-actions">
          <Button variant="ghost" size="sm" onClick={() => { setResetFor(user.id); setResetPassword(''); }}><KeyRound size={14} />Reset password</Button>
          <Button variant="ghost" size="sm" onClick={() => action(user.id, 'revoke-sessions')}>Revoke sessions</Button>
          {user.banned ? <Button variant="outline" size="sm" onClick={() => action(user.id, 'unban')}><UserRoundCheck size={14} />Enable</Button> : <Button variant="destructive" size="sm" onClick={() => action(user.id, 'ban')}><UserRoundX size={14} />Disable</Button>}
        </div>
      </div>)}
    </div>
    {resetFor && <form className="password-reset" onSubmit={setPassword}><strong>Set a new temporary password</strong><Input type="password" minLength={12} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required autoFocus /><div><Button variant="outline" type="button" onClick={() => setResetFor(null)}>Cancel</Button><Button type="submit">Set password</Button></div></form>}
  </section>;
}

async function adminRequest<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
