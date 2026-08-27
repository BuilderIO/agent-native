import { useT } from "@agent-native/core/client/i18n";
import { IconArrowRight, IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { applyFirstTouchAttributionToLink } from "./marketing-attribution";
import { trackEvent } from "./TemplateCard";

export const SLIDES_TRY_NOW_PROMPTS = [
  "Launch deck for a running-shoe drop, in the style of nike.com.",
  "Fundraising deck for a coastal cleanup nonprofit, in the style of Patagonia.",
  "Nvidia's last four quarters, from their investor filings, in the style of nvidia.com.",
  "A sales deck for an AI support platform, in the style of stripe.com.",
  "US housing market snapshot, with Census and Zillow research data.",
  "Intro to LLMs for MBA students, in the style of apple.com.",
  "Global EV adoption since 2015, using Our World in Data.",
] as const;

export const PROMPT_TYPE_INTERVAL_MS = 24;
export const PROMPT_DELETE_INTERVAL_MS = 12;
export const PROMPT_HOLD_MS = 2_000;

export function extractPromptText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement;
    if (element.tagName === "BR") {
      return "\n";
    }
    let result = "";
    for (const child of Array.from(element.childNodes)) {
      result += extractPromptText(child);
    }
    return result;
  }
  return "";
}

export function SlidesTryNow() {
  const t = useT();
  const tn = (key: string) => t(`templateLanding.slides.tryNow.${key}`);
  const [promptText, setPromptText] = useState("");
  const promptRef = useRef<HTMLDivElement>(null);
  const animationStoppedRef = useRef(false);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptHref = `https://slides.agent-native.com/?initialPrompt=${encodeURIComponent(promptText)}`;

  const stopPromptAnimation = () => {
    animationStoppedRef.current = true;
    if (animationTimerRef.current !== null) {
      clearTimeout(animationTimerRef.current);
      animationTimerRef.current = null;
    }
  };

  useEffect(() => {
    const prompt = promptRef.current;
    if (!prompt) return;

    const visiblePromptText = extractPromptText(prompt).trim();
    if (document.activeElement === prompt || visiblePromptText) {
      stopPromptAnimation();
      setPromptText(visiblePromptText);
      return;
    }

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      prompt.textContent = SLIDES_TRY_NOW_PROMPTS[0];
      setPromptText(SLIDES_TRY_NOW_PROMPTS[0]);
      return;
    }

    let promptIndex = 0;
    let characterIndex = 0;
    let deleting = false;

    const scheduleNextStep = (delay: number) => {
      animationTimerRef.current = setTimeout(advanceAnimation, delay);
    };

    const advanceAnimation = () => {
      if (animationStoppedRef.current) return;

      const currentPrompt = SLIDES_TRY_NOW_PROMPTS[promptIndex];
      if (deleting) {
        characterIndex -= 1;
        const nextText = currentPrompt.slice(0, characterIndex);
        prompt.textContent = nextText;
        setPromptText(nextText);

        if (characterIndex === 0) {
          promptIndex = (promptIndex + 1) % SLIDES_TRY_NOW_PROMPTS.length;
          deleting = false;
          scheduleNextStep(PROMPT_TYPE_INTERVAL_MS);
        } else {
          scheduleNextStep(PROMPT_DELETE_INTERVAL_MS);
        }
        return;
      }

      characterIndex += 1;
      const nextText = currentPrompt.slice(0, characterIndex);
      prompt.textContent = nextText;
      setPromptText(nextText);

      if (characterIndex === currentPrompt.length) {
        deleting = true;
        scheduleNextStep(PROMPT_HOLD_MS);
      } else {
        scheduleNextStep(PROMPT_TYPE_INTERVAL_MS);
      }
    };

    scheduleNextStep(PROMPT_TYPE_INTERVAL_MS);

    return () => {
      if (animationTimerRef.current !== null) {
        clearTimeout(animationTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="w-full min-w-0 text-start">
      <div className="flex min-h-[22rem] min-w-0 flex-col gap-3 rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-4 sm:p-6">
        <div className="flex items-center gap-1.5">
          <span
            id="slides-try-now-prompt-label"
            className="text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]"
          >
            {tn("composerLabel")}
          </span>
          <div className="group relative inline-flex items-center">
            <button
              type="button"
              aria-label={tn("promptTip")}
              className="inline-flex size-4 items-center justify-center rounded-full text-[var(--fg-secondary)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--docs-accent)]"
            >
              <IconInfoCircle size={14} aria-hidden="true" />
            </button>
            <div
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 hidden w-64 rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-2.5 text-xs font-normal normal-case leading-relaxed text-[var(--fg)] shadow-lg group-hover:block group-focus-within:block"
            >
              {/* i18n-ignore: product guidance copy */}
              Be specific. Generic prompts = generic decks. Say who it is for,
              paste your notes, and even reference a website design you want to
              copy.
            </div>
          </div>
        </div>
        <div
          ref={promptRef}
          id="slides-try-now-prompt"
          role="textbox"
          aria-labelledby="slides-try-now-prompt-label"
          aria-multiline="true"
          contentEditable
          suppressContentEditableWarning
          onPointerDown={stopPromptAnimation}
          onTouchStart={stopPromptAnimation}
          onFocus={stopPromptAnimation}
          onBeforeInput={stopPromptAnimation}
          onPaste={stopPromptAnimation}
          onKeyDown={stopPromptAnimation}
          onInput={(event) => {
            stopPromptAnimation();
            setPromptText(extractPromptText(event.currentTarget).trim());
          }}
          className="min-h-48 w-full flex-1 rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-4 text-sm leading-8 text-[var(--fg)] outline-none transition-colors focus-visible:border-[var(--docs-accent)] focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]"
        />
        <div className="flex justify-end">
          <a
            href={promptHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--fg)] px-6 text-sm font-semibold text-[var(--bg)] outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]"
            onClick={(event) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("generate deck", {
                template: "slides",
                location: "try_now",
              });
            }}
          >
            {tn("submit")}
            <IconArrowRight aria-hidden="true" size={16} />
          </a>
        </div>
      </div>
      <p className="m-0 mt-3 text-center text-sm text-[var(--fg-secondary)]">
        Or{" "}
        <a
          href="https://slides.agent-native.com/_agent-native/sign-in"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[var(--fg)] underline underline-offset-2 hover:no-underline"
        >
          sign in
        </a>{" "}
        to access Slides via webhook, MCP, or A2A integration.
      </p>
    </div>
  );
}
