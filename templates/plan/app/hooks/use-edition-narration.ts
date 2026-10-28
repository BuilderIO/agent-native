import {
  fetchSpeechClip,
  SPEECH_MAX_CHARS,
} from "@agent-native/core/client/speak";
import {
  chunkEditionSpeech,
  EDITION_SPEECH_INSTRUCTIONS,
} from "@shared/edition-speech";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The voice the edition is read in. Chosen once rather than exposed as a
 * picker: the complaint neural narration fixes is the platform's own default
 * voice, not the absence of ten alternatives.
 */
const EDITION_VOICE = "sage";

export type NarrationState = "idle" | "loading" | "playing" | "paused";

export interface EditionNarration {
  state: NarrationState;
  play: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

/**
 * Narrate an edition with a neural voice, streamed as a playlist.
 *
 * The script is chunked on segment boundaries so playback starts after the
 * first chunk instead of after the whole bulletin, and each chunk's audio is
 * cached for the life of the page so a replay costs nothing. A chunk that
 * cannot be synthesised stops playback and reports — a listener who hears the
 * bulletin end early must not think that was the end of the news.
 */
export function useEditionNarration({
  segments,
  onUnavailable,
  onError,
}: {
  segments: string[];
  /**
   * Called when no provider is configured, with the server's own explanation
   * so a caller that cannot fall back has something to show.
   */
  onUnavailable: (message: string) => void;
  onError: (message: string) => void;
}): EditionNarration {
  const chunks = useMemo(
    () => chunkEditionSpeech(segments, SPEECH_MAX_CHARS),
    [segments],
  );
  const [state, setState] = useState<NarrationState>("idle");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlsRef = useRef(new Map<number, string>());
  const indexRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Playback advances from the audio element's own `ended` event, which fires
  // outside React; the callbacks it needs are read through a ref so the
  // listener does not have to be torn down and rebuilt on every render.
  const handlersRef = useRef({ onUnavailable, onError });
  handlersRef.current = { onUnavailable, onError };

  const releaseUrls = useCallback(() => {
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    urlsRef.current.clear();
  }, []);

  const clipUrl = useCallback(
    async (index: number): Promise<string | null> => {
      const cached = urlsRef.current.get(index);
      if (cached) return cached;
      const chunk = chunks[index];
      if (!chunk) return null;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const result = await fetchSpeechClip({
        text: chunk,
        voice: EDITION_VOICE,
        instructions: EDITION_SPEECH_INSTRUCTIONS,
        signal: controller.signal,
      });
      if (result.status === "failed") {
        if (result.reason === "no-provider") {
          handlersRef.current.onUnavailable(result.message);
        } else if (!controller.signal.aborted) {
          handlersRef.current.onError(result.message);
        }
        return null;
      }
      const url = URL.createObjectURL(result.blob);
      urlsRef.current.set(index, url);
      return url;
    },
    [chunks],
  );

  const playFrom = useCallback(
    async (index: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      setState("loading");
      const url = await clipUrl(index);
      if (!url) {
        setState("idle");
        return;
      }
      indexRef.current = index;
      audio.src = url;
      try {
        await audio.play();
      } catch (err) {
        // An autoplay rejection is not a synthesis failure, but it is still
        // silence the listener asked to end — say so instead of sitting idle.
        handlersRef.current.onError((err as Error)?.message ?? String(err));
        setState("idle");
        return;
      }
      setState("playing");
      // Warm the next chunk while this one plays so the seam is inaudible.
      if (chunks[index + 1] && !urlsRef.current.has(index + 1)) {
        void clipUrl(index + 1);
      }
    },
    [chunks, clipUrl],
  );

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
    const onEnded = () => {
      const next = indexRef.current + 1;
      if (next < chunks.length) {
        void playFrom(next);
        return;
      }
      indexRef.current = 0;
      setState("idle");
    };
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      audio.removeAttribute("src");
      audioRef.current = null;
    };
  }, [chunks, playFrom]);

  // A new edition must not keep narrating the previous one, and its clips are
  // dead weight the moment the script changes.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      releaseUrls();
      indexRef.current = 0;
      setState("idle");
    },
    [chunks, releaseUrls],
  );

  const play = useCallback(() => void playFrom(0), [playFrom]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    void audioRef.current?.play();
    setState("playing");
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    indexRef.current = 0;
    setState("idle");
  }, []);

  return { state, play, pause, resume, stop };
}
