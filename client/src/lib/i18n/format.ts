/**
 * Dates and times, in the language you picked rather than the one the OS is in.
 *
 * There were eight `toLocaleDateString(undefined, ...)` calls scattered across
 * the app before this file, all passing `undefined` for the locale, which means
 * "whatever the browser is set to". That is the right default when there is no
 * language setting and the wrong one the moment there is: choosing Dutch and
 * still being shown `Sep 8, 2026` is a translation that stopped halfway.
 *
 * Two shapes cover every call site, so there are two functions.
 */
import type { Locale } from './locales';

/** `14:32`. 24 hour everywhere, which is what the app already did. */
export function clockTime(iso: string | Date, locale: Locale): string {
  const at = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return timeFormat(locale).format(at);
}

/** `8 Sep 2026`, ordered and abbreviated however the locale does it. */
export function shortDay(iso: string | Date, locale: Locale): string {
  const at = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return dayFormat(locale).format(at);
}

/** Whether two instants land on the same calendar day, locally. */
export function isSameDay(a: string | Date, b: string | Date): boolean {
  const one = a instanceof Date ? a : new Date(a);
  const two = b instanceof Date ? b : new Date(b);
  return one.toDateString() === two.toDateString();
}

// Built once per locale rather than per render. Constructing an Intl formatter
// is not cheap and a message list does it once a row.
const times = new Map<Locale, Intl.DateTimeFormat>();
const days = new Map<Locale, Intl.DateTimeFormat>();

function timeFormat(locale: Locale): Intl.DateTimeFormat {
  let format = times.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    times.set(locale, format);
  }
  return format;
}

function dayFormat(locale: Locale): Intl.DateTimeFormat {
  let format = days.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    days.set(locale, format);
  }
  return format;
}
