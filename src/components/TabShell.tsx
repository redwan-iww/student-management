import { useEffect, useState, type ReactNode } from 'react';
import { Loader, useDelayed } from './Loader';
import { describeError } from '../zoho/client';
import { initTab, NotInsideCrmError, type HandshakeFailure } from '../zoho/sdk';

type State =
  | { kind: 'init' }
  | { kind: 'outside'; reason: HandshakeFailure; waitedMs: number }
  | { kind: 'failed'; message: string }
  | { kind: 'ready' }
  // Handshake never came and the dev proxy has no credentials, so there is no
  // transport at all. Dev-only: in production this is `outside` instead.
  | { kind: 'needs-credentials'; reason: HandshakeFailure }
  // Handshake never came, but the live dev proxy is configured -- so this is
  // real demo3 data reached over REST rather than through the SDK.
  | { kind: 'ready-live'; reason: HandshakeFailure };

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
    headline: 'The CRM never completed the handshake',
    detail:
      'The SDK loaded and init() was called, but neither init() nor PageLoad ' +
      'came back within the timeout. Usually this means the page is framed by ' +
      'something other than CRM, or it was registered in a way that does not ' +
      'get a handshake. If the tab is registered and this persists, the dev ' +
      'proxy (.env, docs/live-dev.md) is the fallback route to real data.',
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
          // In dev, an unanswered handshake should not be a dead end: install
          // the live adapter and render, so the tab can be worked on before the
          // widget is registered. That is real demo3 data, just reached over
          // REST instead of through the SDK. It is the only dev transport --
          // there are no fixtures to fall back on -- so without credentials
          // the tab says so rather than inventing data. Never in a production
          // build: there, a dev transport masquerading as the SDK path would be
          // worse than an error.
          if (import.meta.env.DEV) {
            void import('virtual:zoho-mode').then(async ({ LIVE }) => {
              if (cancelled) return;
              if (!LIVE) {
                setState({ kind: 'needs-credentials', reason: err.reason });
                return;
              }
              const { installLiveZoho } = await import('../zoho/live');
              if (cancelled) return;
              installLiveZoho();
              setState({ kind: 'ready-live', reason: err.reason });
            });
            return;
          }
          setState({ kind: 'outside', reason: err.reason, waitedMs: err.waitedMs });
        }
        else setState({ kind: 'failed', message: describeError(err) });
      });
    return () => { cancelled = true; };
  }, []);

  // The handshake is usually quick; only mention the wait if it is not.
  const showConnecting = useDelayed(state.kind === 'init');

  return (
    <>
      <header className="tabhead">
        <h1>{title}</h1>
      </header>

      {state.kind === 'init' && showConnecting && (
        <Loader label="Connecting to Zoho CRM…" />
      )}

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

      {/* Dev-only, and gated on DEV here as well as at the setState that
          produces it -- otherwise the markup (and the credential *names* in
          it) ships in the production bundle to a branch that can never run. */}
      {import.meta.env.DEV && state.kind === 'needs-credentials' && (
        <div className="notice">
          <h2>Live mode is off — add OAuth credentials</h2>
          <p>
            No CRM handshake (<code>{state.reason}</code>), and the dev proxy has
            no credentials, so there is nothing to read from. Copy{' '}
            <code>.env.example</code> to <code>.env</code>, fill in{' '}
            <code>ZOHO_CLIENT_ID</code>, <code>ZOHO_CLIENT_SECRET</code> and{' '}
            <code>ZOHO_REFRESH_TOKEN</code>, then restart the dev server —
            credentials are read at startup, not per request.
          </p>
          <p className="muted">
            See <code>docs/live-dev.md</code>. Inside CRM this tab reaches demo3
            through the SDK with no credentials at all; if you are seeing this
            there, the handshake did not complete.
          </p>
        </div>
      )}

      {state.kind === 'ready-live' && (
        <p className="devbar">
          No CRM handshake ({state.reason}) — but reading and writing <strong>real demo3
          records</strong> over the dev proxy. Register this as a widget to use the SDK path.
        </p>
      )}

      {state.kind === 'failed' && <p className="error">{state.message}</p>}
      {(state.kind === 'ready' || state.kind === 'ready-live') && children}
    </>
  );
}
