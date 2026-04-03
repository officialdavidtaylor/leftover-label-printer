import { redirect, useLoaderData } from 'react-router';

import { completeAuthentication } from '../lib/auth/oidc-client';
import styles from './auth.callback.module.css';

type CallbackLoaderData = {
  error: string | null;
};

export async function clientLoader({ request }: { request: Request }): Promise<CallbackLoaderData> {
  try {
    const { returnTo } = await completeAuthentication(request.url);
    // React Router loaders/actions use thrown Response objects for redirects.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect(returnTo);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    return {
      error: error instanceof Error ? error.message : 'Unable to complete sign-in.',
    };
  }
}

clientLoader.hydrate = true;

export default function AuthCallbackPage() {
  const data: CallbackLoaderData = useLoaderData();

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <h1 className={styles.panel__title}>Finishing sign-in</h1>
        <p className={styles.panel__description}>
          {data.error ?? 'Returning you to the print workflow.'}
        </p>
      </section>
    </main>
  );
}
