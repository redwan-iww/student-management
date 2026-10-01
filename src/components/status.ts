import type { AllocationStatus, ClassStatus } from '../generated/types';
import type { Tone } from './ui';

// Domain status -> badge tone, in one place.
//
// This logic used to be written twice, in two different shapes: a four-branch
// nested ternary in the timetable and a template literal in the allocation
// table. Keeping it here is what stops the same value reading green on one
// screen and amber on the other.
//
// The strings are enum values from schema/enums.yaml via src/generated/types.ts
// and are never renamed -- see CLAUDE.md.

export type Status = { tone: Tone; label: string };

/**
 * A lesson's state in the timetable, which is derived rather than stored.
 *
 * `session_status` has five values but only `Cancelled` is meaningful here;
 * whether the register has been taken lives in a separate boolean, and
 * "upcoming" is a fact about the date, not about the record. So the badge is
 * computed from all three.
 */
export function sessionTone(cancelled: boolean, taken: boolean, upcoming: boolean): Status {
  if (cancelled) return { tone: 'neutral', label: 'Cancelled' };
  if (taken) return { tone: 'positive', label: 'Attendance taken' };
  if (upcoming) return { tone: 'pending', label: 'Upcoming' };
  return { tone: 'pending', label: 'Not taken' };
}

/**
 * A teaching allocation's stored status.
 *
 * Mapped per value. The previous two-way test -- anything that is not `Ended`
 * is green -- showed `Planned` and `Cancelled` as if they were active.
 * Row dimming and the End button still key off `Ended` alone, unchanged.
 */
export function allocationTone(status: string): Status {
  const known = status as AllocationStatus;
  switch (known) {
    case 'Active':
      return { tone: 'positive', label: 'Active' };
    case 'Planned':
      return { tone: 'pending', label: 'Planned' };
    case 'Ended':
      return { tone: 'neutral', label: 'Ended' };
    case 'Cancelled':
      return { tone: 'neutral', label: 'Cancelled' };
    default:
      // A value the schema has since grown, or an empty field.
      return { tone: 'neutral', label: status || '—' };
  }
}

/**
 * A class's own lifecycle status, which the staffing list did not show at all.
 *
 * Running is the only state that is actively happening, so it is the only
 * positive one. Draft and Scheduled are both "not yet", but Draft means
 * incomplete rather than merely future, so it reads as the quieter of the two.
 */
export function classTone(status: string): Status {
  const known = status as ClassStatus;
  switch (known) {
    case 'Running':
      return { tone: 'positive', label: 'Running' };
    case 'Scheduled':
      return { tone: 'pending', label: 'Scheduled' };
    case 'Draft':
      return { tone: 'neutral', label: 'Draft' };
    case 'Completed':
      return { tone: 'neutral', label: 'Completed' };
    case 'Cancelled':
      return { tone: 'critical', label: 'Cancelled' };
    default:
      return { tone: 'neutral', label: status || '—' };
  }
}

/** 'Monday','Wednesday' -> 'Mon, Wed'. A timetable cell has no room for the rest. */
export function shortDays(days: readonly string[]): string {
  return days.map((d) => d.slice(0, 3)).join(', ');
}

/**
 * Morning, afternoon or evening, from a class's start time.
 *
 * Derived rather than stored. A section letter says only that two classes of a
 * course differ, not how -- reading "-A" and "-B" means reading the times to
 * work out which one meets after work. The times are already there, so the
 * label follows from them and cannot drift out of step the way a hand-entered
 * one would.
 *
 * Returns '' for a class with no start time, which the generator also treats
 * as unschedulable.
 */
export function shiftOf(startTime: string): '' | 'Morning' | 'Afternoon' | 'Evening' {
  if (!/^\d{1,2}:\d{2}$/.test(startTime)) return '';
  const padded = startTime.padStart(5, '0');
  if (padded < '12:00') return 'Morning';
  if (padded < '17:00') return 'Afternoon';
  return 'Evening';
}

/**
 * How a class's programmes read on one line.
 *
 * A course belongs to every programme that teaches it, and the common ones --
 * English, Maths -- belong to all of them. Printing the list put four names on
 * a class card and buried the thing the card is actually for: the name, the
 * time and the room. Worse, it said the least where it took the most room,
 * since "offered everywhere" is the one case that distinguishes nothing.
 *
 * So the list collapses once it stops being a useful distinction. The full
 * list goes in `title` either way, and the panel behind the card still spells
 * it out in full, so nothing is only ever a tooltip.
 *
 * `total` is how many programmes exist in the term. Pass 0 if unknown -- the
 * "all of them" case is then simply not detected and the count is shown.
 */
export function programLabel(
  list: { name: string }[],
  total: number,
): { text: string; lead: string; title: string } | null {
  if (list.length === 0) return null;
  const title = list.map((p) => p.name).join(', ');
  // `lead` is the same label for a sentence that already began -- "Open to
  // all programmes" rather than "Open to All programmes". Callers that start
  // a line with it use `text`; callers that continue one use `lead`.
  if (total > 1 && list.length >= total) {
    return { text: 'All programmes', lead: 'all programmes', title };
  }
  if (list.length <= 2) {
    const names = list.map((p) => p.name).join(' · ');
    return { text: names, lead: names, title };
  }
  const n = `${list.length} programmes`;
  return { text: n, lead: n, title };
}
