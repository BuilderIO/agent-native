import { useEffect } from "react";
import type { VideoPlayerHandle } from "@/components/player/video-player";
import { SPEED_OPTIONS } from "@/components/player/player-controls";

export interface UsePlayerShortcutsOpts {
  playerRef: React.RefObject<VideoPlayerHandle | null>;
  speed: number;
  setSpeed: (v: number) => void;
  enabled?: boolean;
}

/**
 * Wires up Clips' player-page keyboard shortcuts.
 *
 *  Space / K  → play/pause
 *  J / ←      → back 6s
 *  L / →      → forward 6s
 *  F          → fullscreen
 *  M          → mute
 *  > / .      → speed up
 *  < / ,      → speed down
 *  C          → toggle captions
 *
 * Ignores events when focus is inside an input/textarea/contenteditable.
 */
export function usePlayerShortcuts(opts: UsePlayerShortcutsOpts) {
  const { playerRef, speed, setSpeed, enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return;

    function onKey(e: KeyboardEvent) {
      if (shouldIgnore(e.target)) return;
      const player = playerRef.current;
      if (!player) return;
      const v = player.video;
      if (!v) return;

      switch (e.key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          if (v.paused) v.play();
          else v.pause();
          break;
        case "j":
        case "J":
        case "ArrowLeft":
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 6);
          break;
        case "l":
        case "L":
        case "ArrowRight":
          e.preventDefault();
          v.currentTime = Math.min(
            v.duration || v.currentTime,
            v.currentTime + 6,
          );
          break;
        case "f":
        case "F":
          e.preventDefault();
          player.toggleFullscreen();
          break;
        case "m":
        case "M":
          e.preventDefault();
          player.toggleMute();
          break;
        case "c":
        case "C":
          e.preventDefault();
          player.toggleCaptions();
          break;
        case ">":
        case ".": {
          e.preventDefault();
          const idx = SPEED_OPTIONS.indexOf(speed);
          const next =
            idx === -1
              ? (SPEED_OPTIONS.find((s) => s > speed) ?? speed)
              : SPEED_OPTIONS[Math.min(SPEED_OPTIONS.length - 1, idx + 1)];
          player.setSpeed(next);
          setSpeed(next);
          break;
        }
        case "<":
        case ",": {
          e.preventDefault();
          const idx = SPEED_OPTIONS.indexOf(speed);
          const next =
            idx === -1
              ? (SPEED_OPTIONS.slice()
                  .reverse()
                  .find((s) => s < speed) ?? speed)
              : SPEED_OPTIONS[Math.max(0, idx - 1)];
          player.setSpeed(next);
          setSpeed(next);
          break;
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, playerRef, speed, setSpeed]);
}

function shouldIgnore(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return false;
}
