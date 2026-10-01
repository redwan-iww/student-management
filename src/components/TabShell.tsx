import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader, useDelayed } from './Loader';
import { Card } from './ui';
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
 * The element a PageNotice renders into, published by the shell.
 *
 * Null until the shell has mounted and handed over its node, which is why the
 * portal is guarded below rather than assumed.
 */
const NoticeSlot = createContext<HTMLElement | null>(null);

/**
 * Puts its children above the page title, from anywhere inside the page.
 *
 * The tab's heading belongs to the shell, and the screens render as its
 * children -- strictly below it. A notice that outranks the title therefore
 * cannot get there by nesting, so it is portalled into a slot the shell keeps
 * above its own header. Rendered where it belongs in the tree, so the state it
 * depends on stays where it is computed.
 */
export function PageNotice({ children }: { children: ReactNode }) {
  const host = useContext(NoticeSlot);
  return host ? createPortal(children, host) : null;
}

/**
 * Common chrome for both web tabs: waits for the CRM handshake, then renders.
 *
 * A web tab gets no record context from PageLoad, so unlike a detail-view
 * widget there is nothing to route on -- each tab picks its own subject.
 */
export function TabShell({ title, children }: { title: string; children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'init' });
  // A callback ref rather than useRef: the portal needs a render once the node
  // exists, and a ref object mutating would not cause one.
  const [noticeHost, setNoticeHost] = useState<HTMLElement | null>(null);

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
    <main className="page">
      {/* Sits above the heading and collapses to nothing when unused. */}
      <div className="page-notice" ref={setNoticeHost} />

      <header className="tabhead">
        <h1>{title}</h1>
        {/* The dev-proxy marker rides in the header rather than sitting as a
            full-bleed strip above it: it qualifies where the data is coming
            from, which is a caption on the title, not a warning about the
            content below. */}
        {state.kind === 'ready-live' && (
          <span className="devchip">
            <i className="dot" aria-hidden="true" />
            <span>
              No CRM handshake ({state.reason}) — reading and writing{' '}
              <strong>real demo3 records</strong> over the dev proxy.
            </span>
          </span>
        )}
      </header>

      {state.kind === 'init' && showConnecting && (
        <Loader label="Connecting to Zoho CRM…" />
      )}

      {state.kind === 'outside' && (
        <Card title={REMEDY[state.reason].headline} body prose>
          <p>{REMEDY[state.reason].detail}</p>
          <p className="muted">
            diagnosis: <code>{state.reason}</code>
            {state.waitedMs > 0 && <> after {(state.waitedMs / 1000).toFixed(1)}s</>}
          </p>
        </Card>
      )}

      {/* Dev-only, and gated on DEV here as well as at the setState that
          produces it -- otherwise the markup (and the credential *names* in
          it) ships in the production bundle to a branch that can never run. */}
      {import.meta.env.DEV && state.kind === 'needs-credentials' && (
        <Card title="Live mode is off — add OAuth credentials" body prose>
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
        </Card>
      )}

      {state.kind === 'failed' && <p className="error">{state.message}</p>}
      {(state.kind === 'ready' || state.kind === 'ready-live') && (
        <NoticeSlot.Provider value={noticeHost}>{children}</NoticeSlot.Provider>
      )}
    </main>
  );
}
