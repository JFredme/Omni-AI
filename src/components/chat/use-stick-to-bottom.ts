"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const NEAR_BOTTOM_PX = 120;

/**
 * Keeps a scrolling conversation pinned to its newest text while it streams, but lets go the moment you scroll up to
 * read, and offers a way back. `follow` is whatever changes as new text arrives.
 */
export function useStickToBottom(follow: unknown) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const [away, setAway] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    const element = scroller.current;
    if (!element) return;
    pinned.current = true;
    setAway(false);
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const onScroll = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const near = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    pinned.current = near;
    setAway(!near);
  }, []);

  useEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [follow]);

  // Rotating a phone or resizing the window changes the height; stay on the newest message.
  useEffect(() => {
    const onResize = () => {
      const element = scroller.current;
      if (element && pinned.current) element.scrollTop = element.scrollHeight;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return { scroller, onScroll, away, scrollToBottom };
}
