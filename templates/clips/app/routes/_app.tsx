import { useEffect, useRef } from "react";
import { Outlet, useNavigate } from "react-router";
import { LibraryLayout } from "@/components/library/library-layout";
import { useAutoTitleBridge } from "@/hooks/use-auto-title";

function useGlobalSequenceShortcuts() {
  const navigate = useNavigate();
  const bufferRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const sequences: { keys: string[]; path: string }[] = [
      { keys: ["g", "l"], path: "/library" },
      { keys: ["g", "s"], path: "/spaces" },
      { keys: ["g", "m"], path: "/meetings" },
      { keys: ["g", "d"], path: "/dictate" },
      { keys: ["g", "a"], path: "/archive" },
      { keys: ["g", "t"], path: "/trash" },
    ];

    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isEditable =
        (e.target as HTMLElement)?.isContentEditable ||
        (e.target instanceof HTMLElement &&
          e.target.closest("[contenteditable]") != null);
      if (tag === "input" || tag === "textarea" || isEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      clearTimeout(timerRef.current);
      bufferRef.current = [...bufferRef.current, e.key.toLowerCase()].slice(-2);

      for (const seq of sequences) {
        const buf = bufferRef.current;
        if (
          buf.length >= seq.keys.length &&
          buf
            .slice(buf.length - seq.keys.length)
            .every((k, i) => k === seq.keys[i])
        ) {
          e.preventDefault();
          navigate(seq.path);
          bufferRef.current = [];
          return;
        }
      }

      timerRef.current = setTimeout(() => {
        bufferRef.current = [];
      }, 1000);
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(timerRef.current);
    };
  }, [navigate]);
}

// Pathless layout route — keeps the left sidebar + agent chat mounted across
// every library/space/archive/trash navigation. See client-side-routing skill.
export default function AppLayoutRoute() {
  // Watch for server-queued title delegations and dispatch them to the agent
  // chat. `sendToAgentChat` is browser-only so the server can't call it
  // directly; this bridge is how `request-transcript`'s "auto-title when the
  // clip still has the default title" hand-off actually reaches the agent.
  useAutoTitleBridge();
  // G+L/S/A/T sequence shortcuts for library navigation
  useGlobalSequenceShortcuts();

  return (
    <LibraryLayout>
      <Outlet />
    </LibraryLayout>
  );
}
