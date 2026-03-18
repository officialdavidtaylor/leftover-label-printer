import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { redirectAuthenticatedUsers } from '../lib/auth/route-guards';
import { startAuthentication } from '../lib/auth/oidc-client';
import styles from './login.module.css';

export function clientLoader({ request }: { request: Request }) {
  return redirectAuthenticatedUsers(request.url);
}

clientLoader.hydrate = true;

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const returnTo = searchParams.get('returnTo') ?? '/app/print/new';

  async function handleSignIn() {
    setIsStarting(true);
    setError(null);

    try {
      await startAuthentication(returnTo);
    } catch (authError) {
      setIsStarting(false);
      setError(authError instanceof Error ? authError.message : 'Unable to start sign-in.');
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <p className={styles.panel__eyebrow}>Secure OIDC sign-in</p>
        <h1 className={styles.panel__title}>Sign in to open the printer workflow.</h1>
        <p className={styles.panel__description}>
          Authentication uses Authorization Code with PKCE. Once you are signed in, protected routes
          and API actions will reuse the stored session until it expires.
        </p>
        <button
          className={styles.panel__primaryAction}
          type="button"
          onClick={() => {
            void handleSignIn();
          }}
          disabled={isStarting}
          data-testid="login-button"
        >
          {isStarting ? 'Redirecting to sign-in…' : 'Continue with Keycloak'}
        </button>
        {error ? (
          <p className={styles.panel__error} data-testid="login-error">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
