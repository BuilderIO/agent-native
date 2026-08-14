import { useT } from "@agent-native/core/client/i18n";
import { IconArrowRight, IconInfoCircle } from "@tabler/icons-react";
import { useRef } from "react";

import { applyFirstTouchAttributionToLink } from "./marketing-attribution";
import { trackEvent } from "./TemplateCard";

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
  const editorRef = useRef<HTMLDivElement>(null);

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
              aria-label="Prompt tip"
              className="inline-flex size-4 items-center justify-center rounded-full text-[var(--fg-secondary)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--docs-accent)]"
            >
              <IconInfoCircle size={14} aria-hidden="true" />
            </button>
            <div
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 hidden w-64 rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-2.5 text-xs font-normal normal-case leading-relaxed text-[var(--fg)] shadow-lg group-hover:block group-focus-within:block"
            >
              Be specific. Generic prompts = generic decks. Say who it is for,
              paste your notes, and even reference a website design you want to
              copy.
            </div>
          </div>
        </div>
        <div
          ref={editorRef}
          id="slides-try-now-prompt"
          role="textbox"
          aria-labelledby="slides-try-now-prompt-label"
          aria-multiline="true"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Be specific. Say who it is for, paste your notes, or reference a website design..."
          className="min-h-48 w-full flex-1 rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-4 text-sm leading-8 text-[var(--fg)] outline-none transition-colors empty:before:inline-block empty:before:text-[var(--fg-secondary)] empty:before:content-[attr(data-placeholder)] focus-visible:border-[var(--docs-accent)] focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]"
        />
        <div className="flex justify-end">
          <a
            href="https://slides.agent-native.com/?initialPrompt="
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--fg)] px-6 text-sm font-semibold text-[var(--bg)] outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]"
            onClick={(event) => {
              const promptText = editorRef.current
                ? extractPromptText(editorRef.current).trim()
                : "";
              const targetUrl = `https://slides.agent-native.com/?initialPrompt=${encodeURIComponent(promptText)}`;
              event.currentTarget.href = targetUrl;
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
    </div>
  );
}
