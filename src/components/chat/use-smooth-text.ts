"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveals streamed text a little at a time, so it flows onto the screen like a person typing fast instead of arriving in
 * bursts. It speeds up when it is behind and finishes quickly once the reply is complete. With "reduce motion" it just shows
 * the text.
 */
export function useSmoothText(target: string, live: boolean): string {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const targetRef = useRef(target);
  const liveRef = useRef(live);
  const frame = useRef<number | null>(null);
  const last = useRef(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    targetRef.current = target;
    liveRef.current = live;
    if (shownRef.current > target.length) {
      shownRef.current = target.length;
      setShown(target.length);
    }
  }, [target, live]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the media query is only readable on the client
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const tick = (now: number) => {
      const dt = Math.min(64, now - (last.current || now)) / 1000;
      last.current = now;
      const goal = targetRef.current.length;
      const backlog = goal - shownRef.current;
      if (backlog > 0) {
        // Gentle when caught up, faster the further behind it gets, and a quick finish once the reply is complete.
        const perSecond = liveRef.current ? Math.max(70, backlog * 7) : Math.max(400, backlog * 10);
        let next = Math.min(goal, shownRef.current + Math.max(1, Math.round(perSecond * dt)));
        // Prefer ending a word, so the fade-in below lands on whole words.
        if (next < goal) {
          const space = targetRef.current.indexOf(" ", next);
          if (space !== -1 && space - next <= 6) next = space;
        }
        shownRef.current = next;
        setShown(next);
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      last.current = 0;
    };
  }, [reduced]);

  return reduced ? target : target.slice(0, shown);
}
