import { useEffect, useState, type ReactNode } from 'react';
import { initTab, NotInsideCrmError } from '../zoho/sdk';

type State =
  | { kind: 'init' }
  | { kind: 'outside' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready' };

/**
 * Common chrome for both web tabs: waits for the CRM handshake, then renders.
 *
 * A web tab gets no record context from PageLoad, so unlike a detail-view
 * widget there is nothing to route on -- each tab picks its own subject.
 */
export function TabShell({ title, children }: { title: string; children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'init' });

  useEffect(() => {
    let cancelled = false;
    initTab()
      .then(() => { if (!cancelled) setState({ kind: 'ready' }); })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof NotInsideCrmError) setState({ kind: 'outside' });
        else setState({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, []);

  const isDevPreview = import.meta.env.DEV && window.self === window.top;

  return (
    <>
      {isDevPreview && (
        <p className="devbar">Development preview — in-memory fixtures, not live CRM data.</p>
      )}
      <header className="tabhead">
        <h1>{title}</h1>
      </header>

      {state.kind === 'init' && <p className="muted">Connecting to Zoho CRM…</p>}

      {state.kind === 'outside' && (
        <div className="notice">
          <h2>Open this from inside Zoho CRM</h2>
          <p>
            A CRM web tab is handed its context through a postMessage handshake
            with the parent CRM page. Loading this URL directly can never work.
          </p>
        </div>
      )}

      {state.kind === 'failed' && <p className="error">{state.message}</p>}
      {state.kind === 'ready' && children}
    </>
  );
}
