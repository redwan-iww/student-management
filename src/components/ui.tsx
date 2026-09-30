import { useEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

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
  close: 'M18 6L6 18M6 6l12 12',
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
  children,
}: {
  tone: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <i className="dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** A count or a quiet label. No tone, because it carries no judgement. */
export function Chip({ children }: { children: ReactNode }) {
  return <span className="chip">{children}</span>;
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
 * A stable hue per name, so the same teacher is the same colour everywhere and
 * across reloads. Saturation and lightness are fixed rather than hashed: white
 * text has to stay legible on every hue the hash can produce.
 */
function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
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
  children,
}: {
  tone?: 'warn' | 'info' | 'error';
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}`}>
      <Icon name={icon} size={18} />
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Without this the focus ring stays on the card behind the scrim, and a
  // screen reader goes on reading the list rather than the panel.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <div
        className="drawer"
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
          <Button variant="ghost" small onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </Button>
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}
