import { useEffect } from "react";

import type { VideoPlayerHandle } from "@/components/player/video-player";
import {
  parsePlaybackSpeed,
  PLAYBACK_SPEED_OPTIONS,
} from "@/lib/playback-speed";

export interface Chapter {
  startMs: number;
  title: string;
}

export interface UsePlayerShortcutsOpts {
  playerRef: React.RefObject<VideoPlayerHandle | null>;
  chapters?: Chapter[];
  enabled?: boolean;
}

export function usePlayerShortcuts(opts: UsePlayerShortcutsOpts) {
  const { playerRef, chapters = [], enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return;

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (shouldIgnore(e.target)) return;
      const player = playerRef.current;
      if (!player) return;
      const playback = player.readPlayback();
      if (!playback) return;

      switch (e.key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          if (playback.paused) void player.play();
          else player.pause();
          break;
        case "j":
        case "J":
          e.preventDefault();
          player.seek(Math.max(0, playback.currentMs - 6000));
          break;
        case "l":
        case "L":
          e.preventDefault();
          player.seek(Math.min(playback.durationMs, playback.currentMs + 6000));
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            const currentMs = playback.currentMs;
            const prev = [...chapters]
              .reverse()
              .find((c) => c.startMs < currentMs - 500);
            player.seek(prev ? prev.startMs : 0);
          } else {
            player.seek(Math.max(0, playback.currentMs - 6000));
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            const currentMs = playback.currentMs;
            const next = chapters.find((c) => c.startMs > currentMs + 500);
            if (next) player.seek(next.startMs);
          } else {
            player.seek(
              Math.min(playback.durationMs, playback.currentMs + 6000),
            );
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          player.setVolume(Math.min(1, playback.volume + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          player.setVolume(Math.max(0, playback.volume - 0.1));
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
        case ",":
          e.preventDefault();
          player.stepFrame(-1, e.repeat);
          break;
        case ".":
          e.preventDefault();
          player.stepFrame(1, e.repeat);
          break;
        case ">": {
          e.preventDefault();
          const speed = parsePlaybackSpeed(playback.speed) ?? 1.2;
          const idx = PLAYBACK_SPEED_OPTIONS.indexOf(speed);
          const next =
            idx === -1
              ? (PLAYBACK_SPEED_OPTIONS.find((s) => s > speed) ?? speed)
              : PLAYBACK_SPEED_OPTIONS[
                  Math.min(PLAYBACK_SPEED_OPTIONS.length - 1, idx + 1)
                ];
          player.setSpeed(next);
          break;
        }
        case "<": {
          e.preventDefault();
          const speed = parsePlaybackSpeed(playback.speed) ?? 1.2;
          const idx = PLAYBACK_SPEED_OPTIONS.indexOf(speed);
          const next =
            idx === -1
              ? (PLAYBACK_SPEED_OPTIONS.slice()
                  .reverse()
                  .find((s) => s < speed) ?? speed)
              : PLAYBACK_SPEED_OPTIONS[Math.max(0, idx - 1)];
          player.setSpeed(next);
          break;
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, playerRef, chapters]);
}

function shouldIgnore(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return false;
}
