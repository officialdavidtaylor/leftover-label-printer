import './app.css';

import { useEffect } from 'react';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from 'react-router';
import { Provider } from 'react-redux';

import { authHydrated, authSignedOut } from './features/auth/auth.duck';
import { readStoredSession } from './lib/auth/session-storage';
import { store } from './store';
import { ToastRegion } from './components/toast-region/ToastRegion';

export function clientLoader() {
  return {
    session: readStoredSession(),
  };
}

clientLoader.hydrate = true;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function AppRoot() {
  const { session } = useLoaderData<typeof clientLoader>();

  useEffect(() => {
    if (session) {
      store.dispatch(authHydrated(session));
      return;
    }

    store.dispatch(authSignedOut());
  }, [session]);

  return (
    <Provider store={store}>
      <Outlet />
      <ToastRegion />
    </Provider>
  );
}
