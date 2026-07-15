import { useState } from 'react';
import { LogIn, LoaderCircle } from 'lucide-react';
import { authClient } from './auth-client.js';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';

export default function SignIn({ onSignedIn }: { onSignedIn: () => Promise<void> | void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    const result = await authClient.signIn.email({ email, password });
    setWorking(false);
    if (result.error) {
      setError(result.error.message ?? 'Sign-in failed.');
      return;
    }
    await onSignedIn();
    if (window.location.pathname === '/sign-in' && window.location.search) {
      window.location.assign(`/api/auth/oauth2/authorize${window.location.search}`);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-lockup auth-brand">
          <div className="brand-mark"><img src="/birdie-mascot.png" alt="" /></div>
          <div><p className="eyebrow">Shared team knowledge</p><h1>Birdie</h1></div>
        </div>
        <div className="auth-copy">
          <h2>Sign in to your workspace</h2>
          <p>Use the account your Birdie administrator created for you.</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label className="field"><span className="field__label">Email</span><Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="field"><span className="field__label">Password</span><Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="form-error">{error}</p>}
          <Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={17} /> : <LogIn size={17} />}{working ? 'Signing in' : 'Sign in'}</Button>
        </form>
        <p className="auth-help">There is no public sign-up. Ask your Birdie administrator if you need an account or a password reset.</p>
      </section>
    </main>
  );
}
