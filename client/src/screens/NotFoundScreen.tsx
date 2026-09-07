/**
 * The screen for an address that leads nowhere.
 *
 * There is no router in this app yet: AppRoot matches the deep links that
 * exist by hand, so nothing renders this automatically. It takes the path it
 * should report and the way home as props, which is what a route element would
 * hand it later anyway.
 *
 * The copy stays away from apology and away from alarm: a mistyped URL says
 * nothing about the user's messages, and this is a good place to say so, since
 * "did something break?" is a scarier question in an app where the server
 * cannot recover anything for you.
 */
import '../styles/not-found.css';

type Props = {
  /** The address that missed. Defaults to the current one. */
  path?: string;
  /** Primary action. Defaults to sending the browser back to the app root. */
  onHome?: () => void;
};

function currentPath(): string {
  if (typeof window === 'undefined') return '';
  return window.location.pathname + window.location.search;
}

export function NotFoundScreen({ path, onHome }: Props) {
  const missed = path ?? currentPath();
  const goHome = onHome ?? (() => window.location.assign('/'));
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1;

  return (
    <div className="not-found">
      <div className="not-found-panel">
        {/* The app's mark. Decorative here, because the heading below says where you
            are, so a screen reader announcing the logo first would only be in
            the way. */}
        <img className="not-found-mark" src="/logo.png" alt="" width={49} height={56} />

        <p className="not-found-code mono">404</p>

        <h1 className="not-found-title">This page doesn’t exist</h1>
        <p className="not-found-lede">
          Cipher has nothing at this address. It was probably mistyped, or it
          pointed at something that has since moved.
        </p>

        {missed && <p className="not-found-path">{missed}</p>}

        <div className="not-found-actions">
          <button className="not-found-primary" type="button" onClick={goHome}>
            Back to your messages
          </button>
          {canGoBack && (
            <button
              className="not-found-secondary"
              type="button"
              onClick={() => window.history.back()}
            >
              Go back
            </button>
          )}
        </div>

        <p className="not-found-foot">
          Nothing was lost. Your conversations are still where you left them,
          still encrypted.
        </p>
      </div>
    </div>
  );
}
