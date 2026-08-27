import { useT } from "@agent-native/core/client/i18n";
import { IconArrowRight } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { applyFirstTouchAttributionToLink } from "./marketing-attribution";
import { trackEvent } from "./TemplateCard";

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
  const animatedPromptsRef = useRef<readonly string[] | null>(null);
  if (animatedPromptsRef.current === null) {
    animatedPromptsRef.current = [
      tn("animatedPrompt1"),
      tn("animatedPrompt2"),
      tn("animatedPrompt3"),
      tn("animatedPrompt4"),
      tn("animatedPrompt5"),
      tn("animatedPrompt6"),
    ];
  }
  const animatedPrompts = animatedPromptsRef.current;
  const [promptText, setPromptText] = useState("");
  const promptRef = useRef<HTMLParagraphElement>(null);
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
      prompt.textContent = animatedPrompts[0];
      setPromptText(animatedPrompts[0]);
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

      const currentPrompt = animatedPrompts[promptIndex];
      if (deleting) {
        characterIndex -= 1;
        const nextText = currentPrompt.slice(0, characterIndex);
        prompt.textContent = nextText;
        setPromptText(nextText);

        if (characterIndex === 0) {
          promptIndex = (promptIndex + 1) % animatedPrompts.length;
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
      <div className="flex min-h-[22rem] min-w-0 flex-col gap-3 rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-4 transition-colors focus-within:border-[var(--docs-accent)] focus-within:ring-2 focus-within:ring-[var(--docs-accent)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--bg-secondary)] sm:p-6">
        <span id="slides-try-now-prompt-label" className="sr-only">
          {tn("composerLabel")}
        </span>
        <p
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
          className="m-0 min-h-48 w-full flex-1 text-sm leading-8 text-[var(--fg)] outline-none"
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
