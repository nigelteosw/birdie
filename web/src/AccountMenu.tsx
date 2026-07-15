import { useState } from 'react';
import { KeyRound, LogOut, UserRound } from 'lucide-react';
import { authClient, type SessionUser } from './auth-client.js';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';

export default function AccountMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    if (result.error) return setMessage(result.error.message ?? 'Could not change password.');
    setCurrentPassword('');
    setNewPassword('');
    setMessage('Password changed. Other sessions were signed out.');
  }

  async function signOut() {
    await authClient.signOut();
    window.location.assign('/sign-in');
  }

  return (
    <div className="account-menu">
      <Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)}><UserRound size={15} />{user.name}</Button>
      {open && <div className="account-popover">
        <div className="account-identity"><strong>{user.name}</strong><span>{user.email}</span></div>
        <form onSubmit={changePassword} className="account-password">
          <p><KeyRound size={14} /> Change password</p>
          <Input type="password" autoComplete="current-password" placeholder="Current password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
          <Input type="password" autoComplete="new-password" minLength={12} placeholder="New password (12+ characters)" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          <Button type="submit" size="sm">Update password</Button>
        </form>
        {message && <p className="account-message">{message}</p>}
        <Button variant="ghost" size="sm" onClick={signOut}><LogOut size={15} />Sign out</Button>
      </div>}
    </div>
  );
}
