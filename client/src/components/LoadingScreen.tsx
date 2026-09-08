/**
 * The screen you get while the app has nothing to show yet.
 *
 * Three jobs, in order of how often they matter: say the app is alive, say what
 * it is waiting for, and give you something to read while it waits. The last
 * one is the Discord trick: a line of text that changes every few seconds
 * turns "nothing is happening" into "something is happening slowly", which is
 * the difference between waiting and giving up.
 *
 * The bar is real. `progress` is a fraction of work actually finished, counted
 * by whoever is doing the work (see `BOOT_STEPS` in SessionProvider), and it
 * fills to full and holds there when the thing completes. Where nothing can
 * honestly be counted, such as waiting for a network to come back, `progress` is
 * null and the bar sweeps instead, then fills the moment the wait ends. A bar
 * that animates its way to 90% while measuring nothing is the thing everyone
 * has learned to distrust, so it is the one thing this will not do.
 *
 * The tips are about this app rather than jokes: an encrypted messenger has
 * behaviour people genuinely do not expect (a lost key is a lost history), and
 * a loading screen is the one moment it has someone's undivided attention.
 */
import { useEffect, useState } from 'react';
import type { Key } from '../lib/i18n/en';
import { useT } from '../state/I18nProvider';
import { BrandMark } from './BrandMark';
import '../styles/loading.css';

export type LoadingTone =
  /** First paint, before the session is known. Fast, usually one frame. */
  | 'boot'
  /** Connected once, struggling now. The wifi-on-a-train case. */
  | 'slow'
  /** Nothing is getting through at all. */
  | 'offline';

type Props = {
  tone?: LoadingTone;
  /**
   * Overrides the line under the mark, and the detail line under that, which
   * names the step in progress.
   *
   * Catalogue keys rather than words, so a caller cannot hand over an
   * untranslated string. That is not hypothetical: the boot labels are keys,
   * and typed as `string` this prop accepted one and rendered it raw.
   */
  title?: Key;
  detail?: Key;
  /**
   * 0 to 1 of work finished, or null when there is genuinely nothing to count.
   * Reaching 1 fills the bar and marks it done.
   */
  progress?: number | null;
  /** Turn the rotating tips off for a screen that is only up for a moment. */
  tips?: boolean;
  /** Draws it over the app instead of instead of it. */
  overlay?: boolean;
};

const TIPS: Key[] = [
  'load.tip.privateKey',
  'load.tip.perDevice',
  'load.tip.ciphertext',
  'load.tip.lostKey',
  'load.tip.queued',
  'load.tip.securityNumber',
];

const TIP_MS = 6000;

const TITLES: Record<LoadingTone, Key> = {
  boot: 'load.title.boot',
  slow: 'load.title.slow',
  offline: 'load.title.offline',
};

const DETAILS: Record<LoadingTone, Key> = {
  boot: 'load.detail.boot',
  slow: 'load.detail.slow',
  offline: 'load.detail.offline',
};

export function LoadingScreen({
  tone = 'boot',
  title,
  detail,
  progress = null,
  tips = true,
  overlay = false,
}: Props) {
  const t = useT();
  const tip = useRotatingTip(tips);
  const measured = typeof progress === 'number';
  const filled = measured ? Math.min(Math.max(progress, 0), 1) : 0;
  const done = measured && filled >= 1;

  return (
    <div className={`load${overlay ? ' load--overlay' : ''}`} role="status" aria-live="polite">
      <div className="load__card">
        <div className={`load__mark load__mark--${tone}${done ? ' load__mark--done' : ''}`}>
          <BrandMark size={52} label="Cipher" />
        </div>

        <h1 className="load__title">{t(title ?? TITLES[tone])}</h1>
        <p className="load__detail">{t(detail ?? DETAILS[tone])}</p>

        <div
          className={[
            'load__bar',
            `load__bar--${tone}`,
            measured ? 'load__bar--measured' : 'load__bar--sweeping',
            done ? 'load__bar--done' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="progressbar"
          aria-label={t(TITLES[tone])}
          // Announced as a real percentage when there is one, and left
          // indeterminate when there is not, rather than claiming a number.
          aria-valuemin={measured ? 0 : undefined}
          aria-valuemax={measured ? 100 : undefined}
          aria-valuenow={measured ? Math.round(filled * 100) : undefined}
        >
          {measured ? (
            <span className="load__fill" style={{ width: `${filled * 100}%` }} />
          ) : (
            <span className="load__run" />
          )}
        </div>

        {tips && (
          <p className="load__tip" key={tip}>
            <span className="load__tip-label">{t('load.didYouKnow')}</span>
            {t(tip)}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One tip at a time, changing on a timer.
 *
 * Starts on a random one so a reload does not always open on the same
 * sentence, which is what makes a rotation feel like a loop you are stuck in.
 */
function useRotatingTip(enabled: boolean): Key {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * TIPS.length));

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % TIPS.length), TIP_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  return TIPS[index];
}
