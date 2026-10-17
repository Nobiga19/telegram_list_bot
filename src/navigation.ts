import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

export type Screen = 'list' | 'create' | 'history' | 'orders';
type Options = { direction?: 'forward' | 'back'; key?: string; instant?: boolean; resetScroll?: boolean };
type Position = { page: number; panel: number };

// Only the screen body moves. App state and Telegram's session stay mounted.
export function useScreenNavigation() {
  const [screen, setScreen] = useState<Screen>('history');
  const [transitioning, setTransitioning] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const current = useRef({ screen: 'history' as Screen, key: 'history' });
  const positions = useRef(new Map<string, Position>());
  const locked = useRef(false);
  const alive = useRef(true);
  const animation = useRef<Animation | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; animation.current?.cancel(); };
  }, []);

  const navigate = useCallback(async (next: Screen, options: Options = {}) => {
    if (locked.current || !alive.current) return;
    const key = options.key ?? next;
    if (current.current.screen === next && current.current.key === key) return;
    locked.current = true;
    setTransitioning(true);
    const page = pageRef.current;
    const panel = page?.querySelector<HTMLElement>('.browse-scroll');
    positions.current.set(current.current.key, { page: window.scrollY, panel: panel?.scrollTop ?? 0 });
    if (options.resetScroll) positions.current.delete(key);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const moving = !options.instant && !reduced.matches && !!page?.animate;
    const sign = options.direction === 'back' ? -1 : 1;
    // Cancelling also completes the transition if the preference changes mid-flight.
    const reduceMotion = () => { if (reduced.matches) animation.current?.cancel(); };
    reduced.addEventListener('change', reduceMotion);
    const play = async (frames: Keyframe[], duration: number) => {
      if (!page || reduced.matches) return;
      const active = page.animate(frames, { duration, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' });
      animation.current = active;
      try { await active.finished; } catch { /* Cancelled by reduced motion or unmount. */ }
    };
    try {
      if (moving) await play([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-sign * 16}px)` }], 90);
      if (!alive.current) return;
      animation.current?.cancel();
      current.current = { screen: next, key };
      flushSync(() => setScreen(next));
      const saved = positions.current.get(key);
      window.scrollTo({ top: saved?.page ?? 0, behavior: 'instant' });
      const nextPanel = page?.querySelector<HTMLElement>('.browse-scroll');
      if (nextPanel) nextPanel.scrollTop = saved?.panel ?? 0;
      if (moving) await play([{ opacity: 0, transform: `translateX(${sign * 24}px)` }, { opacity: 1, transform: 'translateX(0)' }], 130);
      if (alive.current) {
        // An inert subtree cannot receive focus until React removes the attribute.
        flushSync(() => setTransitioning(false));
        page?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
      }
    } finally {
      reduced.removeEventListener('change', reduceMotion);
      animation.current?.cancel();
      animation.current = null;
      locked.current = false;
      if (alive.current) setTransitioning(false);
    }
  }, []);

  return { screen, navigate, pageRef, transitioning };
}
