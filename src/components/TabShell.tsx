import { useEffect, useState, type ReactNode } from 'react';
import { Loader, useDelayed } from './Loader';
import { describeError } from '../data/client';

/**
 * Common chrome for both pages.
 *
 * This used to wait on the Zoho embeddedApp handshake before rendering. There
 * is no handshake now -- the app talks to its own API -- so the only startup
 * condition worth blocking on is whether that API is reachable. Checking once
 * here means every page gets the same clear message when the server is not
 * running, instead of each view failing separately with its own error.
 */
type State =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'unreachable'; message: string };

const API = import.meta.env.VITE_API_URL ?? '/api';

export function TabShell({ title, children }: { title: string; children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const showChecking = useDelayed(state.kind === 'checking');

  useEffect(() => {
    let cancelled = false;

    fetch(`${API}/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`the API answered ${res.status}`);
        return res.json();
      })
      .then(() => { if (!cancelled) setState({ kind: 'ready' }); })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'unreachable', message: describeError(err) });
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <header className="tabhead">
        <h1>{title}</h1>
      </header>

      {state.kind === 'checking' && showChecking && <Loader label="Connecting…" />}

      {state.kind === 'unreachable' && (
        <div className="notice">
          <h2>The API is not responding</h2>
          <p>
            This app reads and writes through a local API server. Start it in a
            second terminal:
          </p>
          <pre className="cmd">npm run server</pre>
          <p className="muted">{state.message}</p>
        </div>
      )}

      {state.kind === 'ready' && children}
    </>
  );
}
