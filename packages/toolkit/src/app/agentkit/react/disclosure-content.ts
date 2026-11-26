import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { scheduleIdleMount } from "./idle-mount.js";

/** True while a long thread opens, so closed rows can mount later. */
export const AgentKitDeferClosedContentContext = createContext(false);

/**
 * Keeps closed content mounted for find-in-page; in a long thread it mounts
 * at idle, so the history paints first.
 */
export function useUntilFoundContent(
  open: boolean,
  onReveal: (() => void) | undefined,
): { ref: RefObject<HTMLDivElement | null>; mounted: boolean } {
  const ref = useRef<HTMLDivElement>(null);
  const revealRef = useRef(onReveal);
  revealRef.current = onReveal;
  const deferClosed = useContext(AgentKitDeferClosedContentContext);
  const [contentMounted, setContentMounted] = useState(open || !deferClosed);
  if (open && !contentMounted) setContentMounted(true);
  useEffect(() => {
    if (contentMounted) return;
    return scheduleIdleMount(() => setContentMounted(true));
  }, [contentMounted]);
  useEffect(() => {
    const element = ref.current;
    if (!element || open) return;
    element.setAttribute("hidden", "until-found");
    const reveal = () => revealRef.current?.();
    element.addEventListener("beforematch", reveal);
    return () => element.removeEventListener("beforematch", reveal);
  }, [open]);
  return { ref, mounted: contentMounted || open };
}
