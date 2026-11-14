import { useEffect, useState } from 'react';

/** Re-render every `ms` so relative times ("waiting 4 min") stay current. */
export function useNow(ms = 15000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Run `fn` every `ms` while the tab is visible. */
export function usePolling(fn, ms) {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') fn();
    };
    const t = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [fn, ms]);
}
