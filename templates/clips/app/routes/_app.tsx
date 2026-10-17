import { useLab } from "@agent-native/core/client/labs";
import { CLIPS_MEETINGS, CLIPS_VOICE_DICTATION } from "@shared/labs";
import { useEffect, useRef } from "react";
import { Outlet, useNavigate } from "react-router";

import { LibraryLayout } from "@/components/library/library-layout";
import { useAutoTitleBridge } from "@/hooks/use-auto-title";
import { useLocalRecordingRecovery } from "@/hooks/use-local-recording-recovery";
import { useTransactionalEmailBridge } from "@/hooks/use-transactional-email-bridge";

function useGlobalSequenceShortcuts() {
  const navigate = useNavigate();
  const meetingsLabEnabled = useLab(CLIPS_MEETINGS);
  const voiceDictationLabEnabled = useLab(CLIPS_VOICE_DICTATION);
  const bufferRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const sequences: { keys: string[]; path: string }[] = [
      { keys: ["g", "l"], path: "/library" },
      { keys: ["g", "s"], path: "/spaces" },
      ...(meetingsLabEnabled ? [{ keys: ["g", "m"], path: "/meetings" }] : []),
      ...(voiceDictationLabEnabled
        ? [{ keys: ["g", "d"], path: "/dictate" }]
        : []),
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
          void navigate(seq.path);
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
  }, [meetingsLabEnabled, navigate, voiceDictationLabEnabled]);
}

export default function AppLayoutRoute() {
  useAutoTitleBridge();
  useTransactionalEmailBridge();
  useGlobalSequenceShortcuts();
  useLocalRecordingRecovery();

  return (
    <LibraryLayout>
      <Outlet />
    </LibraryLayout>
  );
}
