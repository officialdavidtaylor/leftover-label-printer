import { Outlet, useLoaderData, useNavigate } from 'react-router';

import { signOutLocally } from '../lib/auth/oidc-client';
import { requireAuthenticatedSession } from '../lib/auth/route-guards';
import styles from './app-layout.module.css';

export function clientLoader({ request }: { request: Request }) {
  return {
    session: requireAuthenticatedSession(request.url),
  };
}

clientLoader.hydrate = true;

export default function ProtectedAppLayout() {
  const { session } = useLoaderData<typeof clientLoader>();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOutLocally();
    await navigate('/login');
  }

  return (
    <div className={styles.shell}>
      <header className={styles.shell__header}>
        <div>
          <p className={styles.shell__eyebrow}>Leftover Label Printer</p>
          <h1 className={styles.shell__title}>Creator-first print workflow</h1>
        </div>
        <div className={styles.shell__actions}>
          <div className={styles.shell__identity}>
            <span className={styles.shell__identityLabel}>Signed in</span>
            <strong>{session.name ?? session.email ?? session.userId}</strong>
          </div>
          <button
            className={styles.shell__signOut}
            type="button"
            onClick={() => {
              void handleSignOut();
            }}
            data-testid="app-signout-button"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className={styles.shell__content}>
        <Outlet />
      </main>
    </div>
  );
}
