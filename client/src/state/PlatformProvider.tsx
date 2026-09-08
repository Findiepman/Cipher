/**
 * The platform adapter, as React sees it.
 *
 * Every consumer starts with the web adapter and, in a desktop build, is
 * handed the desktop one a few milliseconds later once its chunk has loaded.
 * That order is safe: the web adapter's answers are all "do the harmless
 * thing", so a badge set before the swap is a title, not a missed call.
 *
 * `usePlatform()` works with no provider above it and answers with the web
 * adapter, so the component tests that mount ChatProvider or CallProvider
 * on their own keep working untouched.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadPlatform, webPlatform, type Platform } from '../lib/platform';

const PlatformContext = createContext<Platform>(webPlatform);

export function PlatformProvider({
  children,
  platform: forced,
}: {
  children: ReactNode;
  /** Injectable for tests. */
  platform?: Platform;
}) {
  const [platform, setPlatform] = useState<Platform>(forced ?? webPlatform);

  useEffect(() => {
    if (forced) return;
    let live = true;
    void loadPlatform().then((loaded) => {
      if (live) setPlatform(loaded);
    });
    return () => {
      live = false;
    };
  }, [forced]);

  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): Platform {
  return useContext(PlatformContext);
}
