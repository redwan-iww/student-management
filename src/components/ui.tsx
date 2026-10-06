import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// Aliased: the DOM KeyboardEvent is used below for a window listener, and an
// unaliased React import would shadow it.
import type { ButtonHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

// Presentational primitives.
//
// Everything here is markup plus a class name -- no state, no data access, no
// effects. The page components own all of that, and they were left alone when
// this file was introduced.
//
// The set is deliberately small. There is no <Table>: the four tables in the
// app share no columns, no sorting and no pagination, so an abstraction over
// them would cost more than the .card wrapper and the element-level CSS.

/* -------------------------------------------------------------------------- */
/* Toolbar slot                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The far end of the page toolbar, published by whichever screen draws one.
 *
 * Null until that screen has mounted and handed over its node, which is why
 * ToolbarEnd guards rather than assumes.
 */
const ToolbarSlot = createContext<HTMLElement | null>(null);

export const ToolbarSlotProvider = ToolbarSlot.Provider;

/**
 * Puts its children at the end of the page toolbar, from anywhere below it.
 *
 * The same trick PageNotice plays on the shell's header, one level down: a
 * control that belongs in the toolbar row but whose state lives deep inside
 * the screen cannot get there by nesting, because the toolbar is drawn above
 * its own children. Rendering it where the state is and portalling the markup
 * keeps the two together -- the alternative is lifting the state up to the
 * toolbar, which means the screen owning a board's worth of edits it never
 * looks at.
 */
export function ToolbarEnd({ children }: { children: ReactNode }) {
  const host = useContext(ToolbarSlot);
  return host ? createPortal(children, host) : null;
}

/* -------------------------------------------------------------------------- */
/* Icons                                                                      */
/* -------------------------------------------------------------------------- */

// Inline SVG rather than an icon package or a sprite file: vite.config.ts sets
// `base: './'` because CRM serves the widget from inside its own iframe, and
// inline paths are the one form that cannot get a path wrong. They also inherit
// currentColor, so an icon in a ghost button and the same icon in a filled one
// need no variants.
const PATHS = {
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  calendar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M9 3v4M15 3v4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  check: 'M20 6L9 17l-5-5',
  'check-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 12.3l2.4 2.4 4.6-5',
  plus: 'M12 5v14M5 12h14',
  alert: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4.5M12 17.2h.01',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  slash: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  // Three stacked lines: a list of things to look at.
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  // An arrow going back round: putting a cancelled lesson back on.
  rotate: 'M3 12a9 9 0 1 0 2.6-6.4M3 4.5V10h5.5',
  close: 'M18 6L6 18M6 6l12 12',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-4.5M12 8h.01',
  pencil: 'M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1.8v2.4M12 19.8v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M1.8 12h2.4M19.8 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
} as const;

export type IconName = keyof typeof PATHS;

/**
 * A stroked 24-grid glyph, sized to its context.
 *
 * Decorative by default -- the surrounding text carries the meaning, so an
 * announced name would only be noise. Pass a `title` for the rare icon that is
 * the only label a control has.
 */
export function Icon({
  name,
  size = 16,
  title,
}: {
  name: IconName;
  size?: number;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

export type ButtonVariant = 'default' | 'primary' | 'accent' | 'ghost' | 'link';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Smaller padding, for buttons that sit inside a row or a chip. */
  small?: boolean;
};

/**
 * The app's only button.
 *
 * `variant` is a class, not a position. The previous stylesheet made the Save
 * button primary through the descendant selector `.sheet-foot button`, so
 * moving it out of the footer would have silently demoted it to a plain
 * button. Defaults to `type="button"` because none of these submit a form, and
 * every other prop passes straight through -- the existing `disabled`,
 * `onClick`, `title` and `aria-label` usage is unchanged.
 */
export function Button({
  variant = 'default',
  small = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    variant === 'link' ? 'btn-link' : 'btn',
    variant !== 'link' && variant !== 'default' ? `btn-${variant}` : '',
    small ? 'btn-sm' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes} {...rest} />;
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */

export type Tone = 'positive' | 'pending' | 'neutral' | 'critical';

/**
 * A status, in one of four tones.
 *
 * Callers pass a tone rather than a colour, and the mapping from a domain
 * status to a tone lives in `status.ts` -- so the same enum value cannot end up
 * green on one screen and grey on another.
 */
export function Badge({
  tone,
  dot = false,
  title,
  children,
}: {
  tone: Tone;
  dot?: boolean;
  /** The long form, for a badge whose label had to be short to fit. */
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {dot && <i className="dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** A count or a quiet label. No tone, because it carries no judgement. */
export function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return <span className="chip" title={title}>{children}</span>;
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */

/** Initials from a display name: 'Anita Nicole Paquin' -> 'AP'. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  // noUncheckedIndexedAccess: every index here is a maybe, including [0] of
  // a string, so each one is narrowed rather than asserted.
  return last ? (first[0] ?? '') + (last[0] ?? '') : first.slice(0, 2);
}

/**
 * A stable hue per name, so the same person is the same colour everywhere and
 * across reloads. Saturation and lightness are fixed rather than hashed: white
 * text has to stay legible on every hue the hash can produce.
 *
 * Exported because the avatar is no longer the only thing wearing it -- the
 * board marks a student's cards with the same colour -- and a person who is
 * teal in one place and amber in another is worse than no colour at all.
 */
/**
 * Eleven hues, not 360. A hash over the whole wheel gave neighbours like 142
 * and 151 -- different numbers, the same green to anyone glancing at a list --
 * and dropped names into the muddy 60-80 band where everything reads olive.
 * Landing on a fixed set means two people are either the same colour or
 * obviously not, with no almost-the-same in between. Spaced to stay apart at
 * 6px wide, which is all the stripe on a student card ever is.
 */
const HUES = [4, 28, 45, 88, 135, 168, 196, 220, 258, 292, 325];

export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return HUES[h % HUES.length] ?? 0;
}

/**
 * Initials in a coloured circle.
 *
 * Purely decorative: the name it stands for is always rendered beside it, so
 * announcing the initials again would just repeat the row.
 */
export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const label = name.trim() || '—';
  return (
    <span
      className={small ? 'avatar avatar-sm' : 'avatar'}
      style={{ background: `hsl(${hueOf(label)} 42% 40%)` }}
      aria-hidden="true"
    >
      {initialsOf(label)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The one surface in the app.
 *
 * `title`/`subtitle`/`action` render a header band; without them the card is
 * just the bordered, rounded, clipped box. Tables go in as `children` with no
 * `body` padding, so their own cell padding reaches the card edge; prose goes
 * in with `body` so it does not.
 */
export function Card({
  title,
  subtitle,
  action,
  body = false,
  prose = false,
  className,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Pad the content. Leave off for a table, which pads its own cells. */
  body?: boolean;
  /** Cap the measure for readable prose. */
  prose?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const classes = ['card', prose ? 'card-prose' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <section className={classes}>
      {(title || action) && (
        <header className="card-head">
          <div className="card-head-text">
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {body ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* EmptyState                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Nothing to show, said deliberately.
 *
 * Folds together the two hand-written empty blocks that had drifted apart --
 * one with an icon and a nav, one with neither. `children` is for whatever the
 * reader should do next.
 */
export function EmptyState({
  icon,
  title,
  detail,
  className,
  children,
}: {
  icon: IconName;
  title: ReactNode;
  detail?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={['empty', className ?? ''].filter(Boolean).join(' ')}>
      {/* Decorative: the heading below carries the meaning. */}
      <div className="empty-mark" aria-hidden="true">
        <Icon name={icon} size={26} />
      </div>
      <h2>{title}</h2>
      {detail && <p className="muted">{detail}</p>}
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Banner                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * An inline explanation attached to the content below it.
 *
 * Distinct from the dev-proxy chip, which this used to share a class with:
 * `.devbar` was both the yellow dev strip and the "this lesson has not happened
 * yet" notice, so neither could be restyled without moving the other.
 */
export function Banner({
  tone = 'warn',
  icon = 'alert',
  compact = false,
  children,
}: {
  tone?: 'warn' | 'info' | 'error';
  icon?: IconName;
  /**
   * A single tight line instead of a padded block. For a standing condition
   * that has to stay on screen the whole time -- a closed enrolment window --
   * where the full-size banner spends most of its height saying nothing.
   */
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}${compact ? ' banner-compact' : ''}`}>
      <Icon name={icon} size={compact ? 14 : 18} />
      <p>{children}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toast                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The outcome of an action, where the action's effect is somewhere else.
 *
 * Dropping a student on a class changes a counter halfway up the page, which
 * is easy to miss and invisible to a screen reader. This says what happened,
 * in one place, for everyone -- it is the live region, so there is no separate
 * visually-hidden announcement to keep in step with it.
 */
export function Toast({
  message,
  tone = 'positive',
  onDismiss,
}: {
  message: string;
  tone?: 'positive' | 'warn' | 'critical';
  onDismiss: () => void;
}) {
  return (
    <div className={`toast toast-${tone}`} role="status" aria-live="polite">
      <Icon name={tone === 'positive' ? 'check-circle' : 'alert'} size={16} />
      <span className="toast-text">{message}</span>
      <button type="button" className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* DateField                                                                   */
/* -------------------------------------------------------------------------- */

/** yyyy-MM-dd -> dd/mm/yyyy. '' for anything that is not a full ISO date. */
function toUk(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * dd/mm/yyyy -> yyyy-MM-dd, or '' if it is not a real date.
 *
 * Separator-agnostic and happy with single digits, because people type
 * 1/9/2026 and a field that rejects it is a field that argues. The round trip
 * through Date catches 31/02, which passes every regex and is not a day.
 */
function fromUk(text: string): string {
  const m = /^(\d{1,2})\s*[/\-. ]\s*(\d{1,2})\s*[/\-. ]\s*(\d{4})$/.exec(text.trim());
  if (!m) return '';
  const [, d, mo, y] = m;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const back = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(back.getTime()) || back.toISOString().slice(0, 10) !== iso ? '' : iso;
}

/** Whether this browser can be asked to open a date picker on demand. */
const CAN_PICK =
  typeof HTMLInputElement !== 'undefined' &&
  typeof HTMLInputElement.prototype.showPicker === 'function';

/**
 * A date field that reads and writes day/month/year.
 *
 * A native `<input type="date">` cannot be told what order to show its parts
 * in -- it follows the browser's own locale, and neither the `lang` attribute
 * nor CSS reaches it -- so an en-US browser rendered every date in this app as
 * mm/dd/yyyy. 09/07/2026 then means two different days to two people reading
 * the same screen, which for a register is not cosmetic.
 *
 * So the visible control is a text box this code formats, and the native input
 * stays only to supply the calendar: hidden, and opened by the button beside
 * the box. The value crossing the boundary is always ISO, so callers are
 * unchanged and nothing downstream has to know this exists.
 *
 * Typing is authoritative and parsing is forgiving: 1/9/2026, 01-09-2026 and
 * 01.09.2026 all land on the same day. A half-typed date is kept as typed and
 * simply not emitted -- clearing the field as you type is how a date field
 * becomes unusable.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  disabled,
  required,
  id,
  className,
  autoFocus,
  'aria-label': ariaLabel,
  onKeyDown,
}: {
  /** yyyy-MM-dd, or '' for empty. */
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}) {
  const native = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => toUk(value));

  // Follow the value when it is changed from outside -- a step, a picker, a
  // reset -- but not while it is being typed, which would fight the caret.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(toUk(value));
  }

  const typed = (next: string) => {
    setText(next);
    const iso = fromUk(next);
    if (iso) onChange(iso);
    else if (next.trim() === '') onChange('');
  };

  // Half a date is not emitted -- the value stays as it was -- so without
  // something on screen the field looks edited while holding the old day, and
  // Enter would commit that old day without a word.
  const malformed = text.trim() !== '' && fromUk(text) === '';

  return (
    <span
      className={['datefield', malformed ? 'is-bad' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        value={text}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-invalid={malformed || undefined}
        onChange={(e) => typed(e.target.value)}
        /* Snap back to the last good value rather than leaving half a date
           on screen pretending to be one. */
        onBlur={() => setText(toUk(value))}
        onKeyDown={onKeyDown}
      />

      {CAN_PICK && (
        <button
          type="button"
          className="datefield-pick"
          disabled={disabled}
          aria-label="Open the calendar"
          title="Open the calendar"
          onClick={() => {
            try {
              native.current?.showPicker();
            } catch {
              // Chrome throws if the call is not treated as user-activated.
              // The text box still works, so there is nothing to recover.
            }
          }}
        >
          <Icon name="calendar" size={15} />
        </button>
      )}

      {/* The calendar, and nothing else. Hidden from layout and from the tab
          order: it is the button above that is the control. */}
      <input
        ref={native}
        type="date"
        className="datefield-native"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Drawer                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A panel over the page, for detail that would bury the list it came from.
 *
 * The app had no overlay of any kind before this -- master/detail was a full
 * view swap with a back button. That is right when the detail *replaces* the
 * task; it is wrong here, because the point of opening a class is to glance at
 * it and carry on placing students behind it.
 *
 * Escape closes, so does the scrim. Focus moves to the panel on open and the
 * page behind it stops scrolling, which is the least a dialog owes a keyboard
 * or screen-reader user.
 */
/* Drawers replace each other: one closes in the same commit the next one
   opens, and React is free to run the new panel's effect before the old
   panel's cleanup. Saving and restoring body.overflow per drawer loses that
   race -- the second drawer records the first drawer's own 'hidden' as the
   value to go back to, and the page stays locked after the last one closes.

   So the lock is counted rather than saved per panel, and only the drawer
   that takes the count from nothing to one records what to restore. */
let scrollLocks = 0;
let scrollWas = '';

function lockScroll() {
  if (scrollLocks === 0) {
    scrollWas = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = scrollWas;
}

/**
 * A dialog in the middle of the screen, with its own footer.
 *
 * The drawer's sibling rather than a variant of it: a drawer is a place you
 * work -- it has a scroll of its own and you come back to it -- while this is
 * one question answered and dismissed. It sits above the drawer deliberately,
 * since the only thing that opens one here is a control inside one.
 *
 * Shares the drawer's scroll lock, which is counted precisely so that closing
 * the modal does not unlock the page while the drawer behind it is still open.
 */
/**
 * Plays a panel's exit animation before telling the parent to unmount it.
 *
 * A drawer animates in because it mounts and the CSS runs; it had nothing on
 * the way out because the parent drops it from the tree the instant onClose
 * fires, and an element that is gone cannot animate. So the panel asks to be
 * closed, marks itself closing -- which is what the exit keyframes hang off --
 * and only then calls up.
 *
 * Returns the flag and the wrapped close. Every way out has to go through it:
 * the button, the scrim and Escape, or one of them vanishes while the others
 * slide.
 *
 * EXIT_MS must match the CSS. A timer shorter than the animation cuts it off;
 * longer leaves the panel sitting finished on screen. animationend would avoid
 * the duplication but does not fire at all under prefers-reduced-motion, where
 * there is no animation -- which is the case that must still close.
 */
const EXIT_MS = 170;

function useExitAnimation(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  // A close already under way must not be started again -- a second Escape
  // would otherwise queue a second timer and call onClose twice.
  const requestClose = useCallback(() => {
    // Nothing to wait for when the stylesheet has turned the animation off:
    // the delay would be 170ms of a panel sitting there doing nothing, which
    // is exactly the sluggishness the setting is asking us to avoid.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onClose();
      return;
    }
    setClosing((already) => {
      if (already) return already;
      timer.current = window.setTimeout(onClose, EXIT_MS);
      return true;
    });
  }, [onClose]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { closing, requestClose };
}

export function Modal({
  title,
  subtitle,
  footer,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Buttons along the bottom. Pinned, so a long body cannot push them away. */
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { closing, requestClose } = useExitAnimation(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Stopped, or the drawer underneath takes the same Escape and both
      // close at once -- which loses the work the modal was collecting.
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      unlockScroll();
    };
  }, [requestClose]);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  /* Portalled to the body rather than rendered where it is written.

     Every modal in this app is opened from inside a drawer, and a drawer is a
     fixed, z-indexed panel pinned to the right of the screen -- so a fixed
     child of it is laid out and stacked inside that, not against the window.
     The dialog came out beside the drawer instead of over the page, and the
     drawer stayed above its scrim.

     The body has no such ancestry, so inset: 0 means the window and z-index 40
     is measured against the drawer's 30 rather than inside it. The React tree
     is unchanged, so the state and the handlers still belong to the component
     that opened it. */
  return createPortal(
    <div
      className={`modal-scrim${closing ? ' is-closing' : ''}`}
      onClick={requestClose}
    >
      <div
        className={`modal${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <div className="drawer-head-text">
            <h2>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <Button variant="ghost" small onClick={requestClose} aria-label="Close">
            <Icon name="close" />
          </Button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { closing, requestClose } = useExitAnimation(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlockScroll();
    };
  }, [requestClose]);

  // Without this the focus ring stays on the card behind the scrim, and a
  // screen reader goes on reading the list rather than the panel.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div
      className={`drawer-scrim${closing ? ' is-closing' : ''}`}
      onClick={requestClose}
    >
      <div
        className={`drawer${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <div className="drawer-head-text">
            <h2>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <Button variant="ghost" small onClick={requestClose} aria-label="Close">
            <Icon name="close" />
          </Button>
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}
