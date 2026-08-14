import { useT } from "@agent-native/core/client/i18n";
import { IconArrowRight } from "@tabler/icons-react";
import { useRef } from "react";
import type { KeyboardEvent } from "react";

import { applyFirstTouchAttributionToLink } from "./marketing-attribution";
import { trackEvent } from "./TemplateCard";

const SUBJECT_PLACEHOLDER = "{type your subject here}";

export function extractPromptText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement;
    if (element.tagName === "SELECT") {
      const select = element as HTMLSelectElement;
      const selectedOption = select.options[select.selectedIndex];
      return selectedOption ? selectedOption.text : select.value;
    }
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

  function handlePromptKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const selection = window.getSelection();
    if (!selection?.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    let candidate: ChildNode | null = null;

    if (range.startContainer === event.currentTarget) {
      candidate =
        event.key === "Backspace"
          ? (event.currentTarget.childNodes[range.startOffset - 1] ?? null)
          : (event.currentTarget.childNodes[range.startOffset] ?? null);
    } else if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const text = range.startContainer.textContent ?? "";
      if (event.key === "Backspace" && range.startOffset === 0) {
        candidate = range.startContainer.previousSibling;
      }
      if (event.key === "Delete" && range.startOffset === text.length) {
        candidate = range.startContainer.nextSibling;
      }
    }

    if (candidate instanceof HTMLSelectElement) {
      event.preventDefault();
      candidate.remove();
    }
  }

  return (
    <div className="w-full min-w-0 text-start">
      <div className="flex min-h-[22rem] min-w-0 flex-col gap-3 rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-4 sm:p-6">
        <div
          id="slides-try-now-prompt-label"
          className="text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]"
        >
          {tn("composerLabel")}
        </div>
        <div
          ref={editorRef}
          id="slides-try-now-prompt"
          role="textbox"
          aria-labelledby="slides-try-now-prompt-label"
          aria-multiline="true"
          contentEditable
          suppressContentEditableWarning
          onKeyDown={handlePromptKeyDown}
          className="min-h-48 w-full flex-1 rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-4 text-sm leading-8 text-[var(--fg)] outline-none transition-colors focus-visible:border-[var(--docs-accent)] focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]"
        >
          {tn("promptCreatePrefix")}{" "}
          <select
            defaultValue="b2b-sales"
            aria-label={tn("deckTypeLabel")}
            className="min-h-10 rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-2 py-1 text-sm font-medium text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)]"
            contentEditable={false}
          >
            <option value="capital-raise">{tn("deckCapitalRaise")}</option>
            <option value="offering-memorandum">
              {tn("deckOfferingMemorandum")}
            </option>
            <option value="b2b-sales">{tn("deckB2bSales")}</option>
            <option value="team-meeting">{tn("deckTeamMeeting")}</option>
            <option value="live-talk">{tn("deckLiveTalk")}</option>
          </select>{" "}
          {tn("promptDeckFor")} {SUBJECT_PLACEHOLDER}.{" "}
          {tn("promptTextShouldBe")}{" "}
          <select
            defaultValue="brief"
            aria-label={tn("textAmountLabel")}
            className="min-h-10 rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-2 py-1 text-sm font-medium text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)]"
            contentEditable={false}
          >
            <option value="minimal">{tn("textMinimal")}</option>
            <option value="brief">{tn("textBrief")}</option>
            <option value="thorough">{tn("textThorough")}</option>
          </select>
          .
        </div>
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
