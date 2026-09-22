import { useEffect, useState, type ReactNode } from 'react';
import { Loader, useDelayed } from './Loader';
import { describeError } from '../zoho/client';
import { initTab, NotInsideCrmError, type HandshakeFailure } from '../zoho/sdk';

type State =
  | { kind: 'init' }
  | { kind: 'outside'; reason: HandshakeFailure; waitedMs: number }
  | { kind: 'failed'; message: string }
  | { kind: 'ready' }
  // Handshake never came, but dev fixtures were installed so the UI still runs.
  | { kind: 'ready-mock'; reason: HandshakeFailure }
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
          // In dev, an unanswered handshake should not be a dead end: install a
          // transport and render, so the tab can be worked on inside the CRM
          // frame before the widget is registered. Prefer the live adapter when
          // the dev proxy has credentials -- that is real demo3 data, just
          // reached over REST instead of through the SDK -- and fall back to
          // fixtures otherwise. Never in a production build: there, fake data
          // masquerading as CRM data would be worse than an error.
          if (import.meta.env.DEV) {
            void import('virtual:zoho-mode').then(async ({ LIVE }) => {
              if (cancelled) return;
              if (LIVE) {
                const { installLiveZoho } = await import('../zoho/live');
                if (cancelled) return;
                installLiveZoho();
                setState({ kind: 'ready-live', reason: err.reason });
              } else {
                const { installMockZoho } = await import('../zoho/mock');
                if (cancelled) return;
                installMockZoho();
                setState({ kind: 'ready-mock', reason: err.reason });
              }
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

  const isDevPreview = import.meta.env.DEV && window.self === window.top;

  return (
    <>
      {isDevPreview && (
        <p className="devbar">Development preview — in-memory fixtures, not live CRM data.</p>
      )}
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

      {state.kind === 'ready-mock' && (
        <p className="devbar warnbar">
          <strong>Sample data — nothing you save here is kept.</strong>{' '}
          Running on in-memory fixtures ({state.reason}): edits survive until you
          reload, then reset. Inside CRM this should normally reach demo3 through
          the SDK with no credentials at all — if you are seeing this there, the
          handshake did not complete. The dev proxy (<code>.env</code>,{' '}
          <code>docs/live-dev.md</code>) is the fallback route.
        </p>
      )}

      {state.kind === 'ready-live' && (
        <p className="devbar">
          No CRM handshake ({state.reason}) — but reading and writing <strong>real demo3
          records</strong> over the dev proxy. Register this as a widget to use the SDK path.
        </p>
      )}

      {state.kind === 'failed' && <p className="error">{state.message}</p>}
      {(state.kind === 'ready' || state.kind === 'ready-mock' || state.kind === 'ready-live') && children}
    </>
  );
}
