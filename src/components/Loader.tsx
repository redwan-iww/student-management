import { useEffect, useState } from 'react';

// Shared busy indicators.
//
// Two shapes, because the two situations differ:
//
//   <Loader label="…" />  replaces content that is not there yet (a roster, a
//                         timetable). Announced politely to screen readers.
//   <Spinner />           sits inside a control that is already on screen and
//                         is now working (a Save button mid-write).
//
// The spinner is a CSS ring rather than an SVG or a GIF so it inherits
// `currentColor` -- the same element works on the white page background and on
// the accent-filled primary button without a second variant.

/** Inline ring, sized to the surrounding text. Decorative by itself. */
export function Spinner({ hidden = false }: { hidden?: boolean }) {
  return <span className="spinner" aria-hidden="true" data-hidden={hidden || undefined} />;
}

/**
 * Block-level busy state standing in for content still being fetched.
 *
 * `role="status"` + `aria-live="polite"` so the label is announced once it
 * appears, without interrupting whatever the reader is on.
 */
export function Loader({ label, inline = false }: { label: string; inline?: boolean }) {
  const line = (
    <p className="loader muted" role="status" aria-live="polite">
      <Spinner />
      <span>{label}</span>
    </p>
  );

  // Default: centred in a pane with real height. These stand in for content
  // that has not arrived, so hugging the top-left corner of an otherwise empty
  // area reads as a stray fragment rather than as the page working.
  // The inline variant is for the few that sit inside an existing box, where the
  // surrounding layout already positions them.
  return inline ? line : <div className="loader-pane">{line}</div>;
}

/**
 * Busy label for a button: spinner plus text, kept on one line.
 *
 * Takes the text rather than composing it so callers can show real progress
 * ("Saving 3 of 9…") instead of an indeterminate "Saving…" where the count is
 * actually known.
 */
export function ButtonBusy({ label }: { label: string }) {
  return (
    <span className="btn-busy">
      <Spinner />
      <span>{label}</span>
    </span>
  );
}

/**
 * True only once `active` has held for `ms`.
 *
 * A fetch that resolves in 80ms should not flash a spinner -- the flash reads
 * as a glitch and is more distracting than a brief still frame. Anything slower
 * than the threshold does need feedback, so the spinner appears then.
 */
export function useDelayed(active: boolean, ms = 220): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);

  return shown;
}
