import { useEffect } from 'react';
import App from './App.js';
import Consent from './Consent.js';
import SignIn from './SignIn.js';
import { authClient } from './auth-client.js';
import { AUTH_EXPIRED_EVENT } from './api.js';

export default function AuthGate() {
  const session = authClient.useSession();

  useEffect(() => {
    const refresh = () => void session.refetch();
    window.addEventListener(AUTH_EXPIRED_EVENT, refresh);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, refresh);
  }, [session.refetch]);

  if (session.isPending) {
    return <main className="auth-shell"><div className="auth-panel"><p>Loading Birdie…</p></div></main>;
  }

  if (!session.data) {
    return <SignIn onSignedIn={() => session.refetch()} />;
  }

  if (window.location.pathname === '/consent') {
    return <Consent user={session.data.user} />;
  }

  if (window.location.pathname === '/sign-in' && window.location.search) {
    window.location.replace(`/api/auth/oauth2/authorize${window.location.search}`);
    return null;
  }

  return <App user={session.data.user} />;
}
