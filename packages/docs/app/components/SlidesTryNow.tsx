import { useT } from "@agent-native/core/client/i18n";
import { IconArrowRight, IconChevronDown, IconPlus } from "@tabler/icons-react";
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
  const [selectedModel, setSelectedModel] = useState("default");
  const promptRef = useRef<HTMLParagraphElement>(null);
  const animationStoppedRef = useRef(false);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptHref = `https://slides.agent-native.com/?initialPrompt=${encodeURIComponent(promptText)}`;
  const modelOptions = [
    { value: "default", label: tn("modelDefault") },
    { value: "gemini-3.1-pro", label: tn("modelGemini") },
    { value: "gpt-5.6-luna", label: tn("modelGpt") },
    { value: "claude-sonnet-5", label: tn("modelClaude") },
  ];
  const selectedModelLabel =
    modelOptions.find((option) => option.value === selectedModel)?.label ??
    modelOptions[0].label;

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
      <div className="flex min-h-[13rem] min-w-0 flex-col gap-3 rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-4 transition-colors focus-within:border-[var(--docs-accent)] focus-within:ring-2 focus-within:ring-[var(--docs-accent)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--bg-secondary)]">
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
          className="m-0 min-h-28 w-full flex-1 text-sm leading-7 text-[var(--fg)] outline-none"
        />
        <div
          data-testid="slides-composer-toolbar"
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          <a
            href={promptHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={tn("uploadToSlides")}
            title={tn("uploadToSlides")}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--fg-secondary)] outline-none transition-colors hover:bg-[var(--docs-border)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)]"
            onClick={(event) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
            }}
          >
            <IconPlus aria-hidden="true" size={16} />
          </a>
          <div className="min-w-0 flex-1" />
          <label className="flex h-7 min-w-0 max-w-[10.5rem] items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--fg-secondary)] transition-colors hover:bg-[var(--docs-border)] hover:text-[var(--fg)] focus-within:ring-2 focus-within:ring-[var(--docs-accent)]">
            <span className="sr-only">{tn("modelLabel")}</span>
            <select
              value={selectedModel}
              aria-label={`${tn("modelLabel")}: ${selectedModelLabel}. ${tn("effortLabel")}: ${tn("effortMedium")}`}
              onChange={(event) => setSelectedModel(event.currentTarget.value)}
              className="min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent text-xs font-medium outline-none"
            >
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="shrink-0 text-[var(--fg-secondary)] opacity-70">
              · {tn("effortMediumShort")}
            </span>
            <IconChevronDown
              aria-hidden="true"
              className="shrink-0 opacity-60"
              size={12}
            />
          </label>
          <a
            href={promptHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--fg)] px-4 text-sm font-semibold text-[var(--bg)] outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]"
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
