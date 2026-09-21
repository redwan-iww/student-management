import { useEffect, useState, type ReactNode } from 'react';
import { initTab, NotInsideCrmError, type HandshakeFailure } from '../zoho/sdk';

type State =
  | { kind: 'init' }
  | { kind: 'outside'; reason: HandshakeFailure; waitedMs: number }
  | { kind: 'failed'; message: string }
  | { kind: 'ready' }
  // Handshake never came, but dev fixtures were installed so the UI still runs.
  | { kind: 'ready-mock'; reason: HandshakeFailure };

/** What to do about each failure, in the reader's terms. */
const REMEDY: Record<HandshakeFailure, { headline: string; detail: string }> = {
  'no-sdk': {
    headline: 'The Zoho SDK script never loaded',
    detail:
      'ZohoEmbededAppSDK.min.js could not be fetched from live.zwidgets.com. ' +
      'Check the Network tab: a blocked request, an offline machine, or a CSP rule.',
  },
  unframed: {
    headline: 'Open this from inside Zoho CRM',
    detail:
      'This URL was loaded on its own. A web tab is handed its context by the ' +
      'parent CRM page, so there is nothing to connect to here.',
  },
  'no-response': {
    headline: 'Registered as a Web Tab, not as a widget',
    detail:
      'The SDK loaded and init() was called, but the CRM never answered. Zoho ' +
      'performs that handshake only for registered widgets. Create it under ' +
      'Setup > Developer Space > Widgets (type: Web Tab) and point the tab at ' +
      'the widget rather than at this URL.',
  },
};

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
        if (err instanceof NotInsideCrmError) {
          // In dev, an unanswered handshake should not be a dead end: install the
          // fixtures and render, so the tab can be worked on inside the CRM frame
          // before the widget is registered. Never in a production build -- there,
          // fake data masquerading as CRM data would be worse than an error.
          if (import.meta.env.DEV) {
            void import('../zoho/mock').then(({ installMockZoho }) => {
              if (cancelled) return;
              installMockZoho();
              setState({ kind: 'ready-mock', reason: err.reason });
            });
            return;
          }
          setState({ kind: 'outside', reason: err.reason, waitedMs: err.waitedMs });
        }
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
          <h2>{REMEDY[state.reason].headline}</h2>
          <p>{REMEDY[state.reason].detail}</p>
          <p className="muted">
            diagnosis: <code>{state.reason}</code>
            {state.waitedMs > 0 && <> after {(state.waitedMs / 1000).toFixed(1)}s</>}
          </p>
        </div>
      )}

      {state.kind === 'ready-mock' && (
        <p className="devbar">
          No CRM handshake ({state.reason}) — showing sample data, not demo3.
          {' '}Register this as a widget to read live records.
        </p>
      )}

      {state.kind === 'failed' && <p className="error">{state.message}</p>}
      {(state.kind === 'ready' || state.kind === 'ready-mock') && children}
    </>
  );
}
