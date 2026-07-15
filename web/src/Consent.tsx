import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { authClient, type SessionUser } from './auth-client.js';
import { Button } from './components/ui/button.js';

export default function Consent({ user }: { user: SessionUser }) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const scopes = useMemo(() => new URLSearchParams(window.location.search).get('scope')?.split(' ').filter(Boolean) ?? [], []);

  async function decide(accept: boolean) {
    setWorking(true);
    setError(null);
    const result = await authClient.oauth2.consent({
      accept,
      oauth_query: window.location.search.slice(1),
    });
    setWorking(false);
    if (result.error) {
      setError(result.error.message ?? 'Could not complete authorization.');
      return;
    }
    if (result.data?.url) window.location.assign(result.data.url);
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel consent-panel">
        <div className="brand-lockup auth-brand"><div className="brand-mark"><img src="/birdie-mascot.png" alt="" /></div><div><p className="eyebrow">MCP authorization</p><h1>Connect to Birdie</h1></div></div>
        <div className="auth-copy"><h2>Allow this MCP client to use Birdie?</h2><p>You are signed in as <strong>{user.email}</strong>. The client will act as you, so captures and reviews are attributed to your account.</p></div>
        <ul className="scope-list">
          {scopes.includes('birdie:read') && <li><Check size={16} /> Read shared lessons and domain guidance</li>}
          {scopes.includes('birdie:write') && <li><Check size={16} /> Capture, edit, and promote lessons</li>}
          {scopes.includes('offline_access') && <li><Check size={16} /> Stay connected until access is revoked</li>}
        </ul>
        {error && <p className="form-error">{error}</p>}
        <div className="consent-actions"><Button variant="outline" disabled={working} onClick={() => decide(false)}><X size={16} />Deny</Button><Button disabled={working} onClick={() => decide(true)}><Check size={16} />Allow access</Button></div>
      </section>
    </main>
  );
}
