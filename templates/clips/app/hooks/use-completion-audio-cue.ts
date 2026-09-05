import { scheduleReadyChime } from "@shared/recording-audio";
import { useCallback, useEffect, useRef } from "react";

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ??
    null
  );
}

/** Prime audio from the initiating gesture, then play one quiet success cue. */
export function useCompletionAudioCue() {
  const contextRef = useRef<AudioContext | null>(null);

  const cancel = useCallback(() => {
    const context = contextRef.current;
    contextRef.current = null;
    if (context) {
      void context.close().catch((error: unknown) => {
        console.debug("[clips] Completion audio cleanup failed", error);
      });
    }
  }, []);

  const prime = useCallback(() => {
    cancel();
    const AudioContextConstructor = audioContextConstructor();
    if (!AudioContextConstructor) return;
    try {
      const context = new AudioContextConstructor();
      contextRef.current = context;
      void context.resume().catch((error: unknown) => {
        console.debug("[clips] Completion audio could not be primed", error);
        if (contextRef.current === context) cancel();
      });
    } catch (error) {
      console.debug("[clips] Completion audio is unavailable", error);
      cancel();
    }
  }, [cancel]);

  const play = useCallback(() => {
    const context = contextRef.current;
    contextRef.current = null;
    if (!context) return;
    void (async () => {
      try {
        if (context.state !== "running") await context.resume();
        await scheduleReadyChime(context);
      } catch (error) {
        // Completion remains visible in Sonner when audio is unavailable.
        console.debug("[clips] Completion audio could not be played", error);
      } finally {
        await context.close().catch((error: unknown) => {
          console.debug("[clips] Completion audio cleanup failed", error);
        });
      }
    })();
  }, []);

  useEffect(() => cancel, [cancel]);

  return { cancel, play, prime };
}
