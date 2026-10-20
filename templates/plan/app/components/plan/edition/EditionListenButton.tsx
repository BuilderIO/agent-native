import { useFormatters, useLocale, useT } from "@agent-native/core/client/i18n";
import type { EditionStoryData } from "@shared/edition";
import { buildEditionSpeech } from "@shared/edition-speech";
import {
  EDITION_SPEECH_RATE,
  pickEditionVoice,
  selectableEditionVoices,
} from "@shared/edition-voice";
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconSettings,
  IconVolume,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type NarrationState,
  useEditionNarration,
} from "@/hooks/use-edition-narration";

import { useEditionDateline } from "./EditionMasthead";

type Playback = "idle" | "speaking" | "paused";
/**
 * Which synthesiser is in play. The browser's own voices are only selectable
 * on that engine, so the voice menu follows this rather than always showing.
 */
type Engine = "neural" | "browser";

const VOICE_STORAGE_KEY = "plan.edition.voice";

/**
 * Read the edition aloud: a neural voice where one is configured, the browser's
 * own synthesiser where it is not.
 *
 * No stored audio either way — narration is per-viewer surface state, not
 * shared source truth, so it never touches the edition. The script comes from
 * `buildEditionSpeech`, which speaks the editorial layer and skips the diffs
 * and file trees the page also shows.
 *
 * The two engines are not interchangeable in quality, so the fallback is
 * reached only when the server says no provider is configured. A provider that
 * is configured and failing reports instead of quietly downgrading, because a
 * silently worse voice is how a broken credential survives for weeks.
 */
export function EditionListenButton({
  edition,
  stories,
}: {
  edition: {
    title: string;
    brief: string;
    dateKey: string | null;
    issueNumber?: number | null;
  };
  stories: EditionStoryData[];
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const { locale } = useLocale();
  const dateline = useEditionDateline(edition.dateKey);
  const segments = useMemo(
    () =>
      buildEditionSpeech({
        nameplate: t("edition.masthead.nameplate"),
        dateline,
        issueLabel:
          typeof edition.issueNumber === "number"
            ? t("edition.masthead.issue", {
                number: formatNumber(edition.issueNumber),
              })
            : null,
        title: edition.title,
        brief: edition.brief,
        stories,
        alsoShippedLabel: t("edition.story.quickLinks"),
      }),
    [t, formatNumber, dateline, edition, stories],
  );
  const [supported, setSupported] = useState(false);
  const [playback, setPlayback] = useState<Playback>("idle");
  const [engine, setEngine] = useState<Engine>("neural");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [preferred, setPreferred] = useState<string | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        "speechSynthesis" in window &&
        typeof window.SpeechSynthesisUtterance === "function",
    );
  }, []);

  // Chrome populates the voice list asynchronously, so the first read is
  // usually empty and the good voices only appear on `voiceschanged`.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const read = () => setVoices(synth.getVoices());
    read();
    synth.addEventListener("voiceschanged", read);
    return () => synth.removeEventListener("voiceschanged", read);
  }, []);

  // Which voice to use is per-viewer surface state, not part of the edition.
  useEffect(() => {
    try {
      setPreferred(window.localStorage.getItem(VOICE_STORAGE_KEY));
    } catch {
      // Private-mode storage denial is not an error worth surfacing.
      setPreferred(null);
    }
  }, []);

  // Speech outlives React. Without this, leaving the page keeps talking.
  useEffect(
    () => () => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    },
    [],
  );

  // A new edition must not keep narrating the previous one.
  useEffect(() => {
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setPlayback("idle");
  }, [segments]);

  const options = useMemo(
    () => selectableEditionVoices(voices, locale),
    [voices, locale],
  );
  const voice = useMemo(() => {
    const chosen = preferred
      ? options.find((option) => option.name === preferred)
      : undefined;
    return chosen ?? pickEditionVoice(options, locale);
  }, [options, preferred, locale]);

  const chooseVoice = useCallback((name: string) => {
    setPreferred(name);
    try {
      window.localStorage.setItem(VOICE_STORAGE_KEY, name);
    } catch {
      // coercion-ok: setPreferred already applied the choice; a private-mode storage denial loses persistence, not the selection.
    }
    window.speechSynthesis.cancel();
    setPlayback("idle");
  }, []);

  const startBrowser = useCallback(() => {
    const synth = window.speechSynthesis;
    synth.cancel();
    segments.forEach((segment, index) => {
      const utterance = new window.SpeechSynthesisUtterance(segment);
      utterance.lang = locale;
      utterance.rate = EDITION_SPEECH_RATE;
      // Left unset when nothing matches the locale: the platform default beats
      // reading English aloud in a voice for another language.
      if (voice) utterance.voice = voice;
      // Only the final segment returns us to idle; the engine owns the queue.
      if (index === segments.length - 1)
        utterance.onend = () => setPlayback("idle");
      synth.speak(utterance);
    });
    setPlayback("speaking");
  }, [segments, locale, voice]);

  const narration = useEditionNarration({
    segments,
    onUnavailable: (message) => {
      setEngine("browser");
      // The click asked for sound, so the fallback starts in the same gesture
      // rather than making the reader press Listen twice.
      if (supported) startBrowser();
      else toast.error(t("edition.listen.failed", { reason: message }));
    },
    onError: (reason) => toast.error(t("edition.listen.failed", { reason })),
  });

  const phase: NarrationState =
    engine === "neural"
      ? narration.state
      : playback === "speaking"
        ? "playing"
        : playback === "paused"
          ? "paused"
          : "idle";

  const toggle = useCallback(() => {
    if (engine === "browser") {
      const synth = window.speechSynthesis;
      if (playback === "speaking") {
        synth.pause();
        setPlayback("paused");
        return;
      }
      if (playback === "paused") {
        synth.resume();
        setPlayback("speaking");
        return;
      }
      startBrowser();
      return;
    }
    if (narration.state === "playing") return narration.pause();
    if (narration.state === "paused") return narration.resume();
    // A second press while a clip is still synthesising would start a second
    // request for the same audio.
    if (narration.state === "loading") return;
    narration.play();
  }, [engine, playback, startBrowser, narration]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setPlayback("idle");
    narration.stop();
  }, [narration]);

  // Absent, not broken: nothing to read means no control.
  if (segments.length === 0) return null;

  const label =
    phase === "playing"
      ? t("edition.listen.pause")
      : phase === "paused"
        ? t("edition.listen.resume")
        : phase === "loading"
          ? t("edition.listen.preparing")
          : t("edition.listen.play");
  const Icon =
    phase === "playing"
      ? IconPlayerPause
      : phase === "paused"
        ? IconPlayerPlay
        : IconVolume;

  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" variant="outline" size="sm" onClick={toggle}>
        <Icon className="size-3.5" />
        {label}
      </Button>
      {phase === "idle" ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={stop}
          aria-label={t("edition.listen.stop")}
        >
          <IconPlayerStop className="size-3.5" />
        </Button>
      )}
      {engine === "browser" && options.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("edition.listen.voice")}
            >
              <IconSettings className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
            <DropdownMenuRadioGroup
              value={voice?.name ?? ""}
              onValueChange={chooseVoice}
            >
              {options.map((option) => (
                <DropdownMenuRadioItem key={option.name} value={option.name}>
                  {option.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
