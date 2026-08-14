import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconArrowRight,
  IconExternalLink,
  IconLoader2,
  IconPalette,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { applyFirstTouchAttributionToLink } from "./marketing-attribution";
import { trackEvent } from "./TemplateCard";

type DesignReference = {
  title: string;
  description: string;
  primaryColor: string | null;
  primaryColorName: string | null;
  accentColor: string | null;
  accentColorName: string | null;
  headingFont: string | null;
  bodyFont: string | null;
};

const SUBJECT_PLACEHOLDER = "{type your subject here}";

function normalizedPublicUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Enter a public website URL.");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not supported.");
  }
  return url.href;
}

function replaceSubjectPlaceholder(editor: HTMLDivElement, subject: string) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent?.includes(SUBJECT_PLACEHOLDER)) continue;
    node.textContent = node.textContent.replace(SUBJECT_PLACEHOLDER, subject);
    return;
  }
}

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

function appendStyleGuideTarget(editor: HTMLDivElement) {
  editor.append(document.createElement("br"), document.createElement("br"));
  const target = document.createElement("span");
  target.dataset.styleGuide = "true";
  target.className = "whitespace-pre-wrap";
  editor.append(target);
  return target;
}

function appendColorSwatch(parent: HTMLElement, color: string) {
  const swatch = document.createElement("span");
  swatch.setAttribute("aria-hidden", "true");
  swatch.className =
    "mx-1 inline-block size-3 rounded-sm border border-black/20 align-middle dark:border-white/30";
  swatch.style.backgroundColor = color;
  parent.append(swatch);
}

export function SlidesTryNow() {
  const t = useT();
  const tn = (key: string) => t(`templateLanding.slides.tryNow.${key}`);
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    },
    [],
  );

  function streamStyleGuide(reference: DesignReference) {
    const editor = editorRef.current;
    if (!editor) return;

    if (reference.title) replaceSubjectPlaceholder(editor, reference.title);

    const colors = [
      reference.primaryColor && {
        code: reference.primaryColor,
        name: reference.primaryColorName,
      },
      reference.accentColor && {
        code: reference.accentColor,
        name: reference.accentColorName,
      },
    ].filter((color): color is { code: string; name: string | null } =>
      Boolean(color),
    );
    const colorFinding = colors.length
      ? `${tn("findingColors")}: ${colors
          .map((color) =>
            color.name ? `${color.name} (${color.code})` : color.code,
          )
          .join(", ")}`
      : "";
    const fonts = [
      ...new Set([reference.headingFont, reference.bodyFont]),
    ].filter((font): font is string => Boolean(font));
    const fontFinding = fonts.length
      ? `${tn("findingFonts")}: ${fonts.join(", ")}`
      : "";
    const findings = [colorFinding, fontFinding].filter(Boolean);
    const header = `## ${tn("styleGuidePrefix")} ${reference.title}`;
    const descriptionLine = reference.description
      ? `\n${reference.description}`
      : "";
    const text = `${header}${descriptionLine}${
      findings.length ? `\n${findings.join("\n")}` : ""
    }`;
    const target = appendStyleGuideTarget(editor);
    let cursor = 0;
    if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    streamTimerRef.current = setInterval(() => {
      cursor = Math.min(text.length, cursor + 4);
      target.textContent = text.slice(0, cursor);
      if (cursor >= text.length && streamTimerRef.current) {
        clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
        if (colors.length) {
          target.textContent = `${header}${descriptionLine}\n${tn("findingColors")}: `;
          colors.forEach((color, index) => {
            if (index) target.append(", ");
            appendColorSwatch(target, color.code);
            target.append(
              color.name ? `${color.name} (${color.code})` : color.code,
            );
          });
          if (fontFinding) target.append(`\n${fontFinding}`);
        }
      }
    }, 10);
  }

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

  async function handleReferenceSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    let safeUrl: string;
    try {
      safeUrl = normalizedPublicUrl(url.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tn("crawlError"));
      return;
    }

    setUrl(safeUrl);
    setIsLoading(true);
    try {
      const reference = (await callAction(
        "crawl-design-reference",
        { url: safeUrl },
        { method: "GET" },
      )) as DesignReference;
      streamStyleGuide(reference);
    } catch {
      setError(tn("crawlError"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="grid w-full min-w-0 gap-4 text-start lg:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
      <aside className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <IconPalette aria-hidden="true" size={18} stroke={1.8} />
          <h3 className="m-0 text-sm font-semibold">{tn("designReference")}</h3>
        </div>
        <form onSubmit={handleReferenceSubmit}>
          <label
            htmlFor="slides-design-reference-url"
            className="mb-2 block text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]"
          >
            {tn("websiteUrl")}
          </label>
          <div className="flex items-stretch gap-2">
            <input
              id="slides-design-reference-url"
              type="text"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={tn("websiteUrlPlaceholder")}
              disabled={isLoading}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] px-3 text-sm text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--fg-secondary)] focus-visible:border-[var(--docs-accent)] focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] disabled:opacity-70"
            />
            <button
              type="submit"
              disabled={!url.trim() || isLoading}
              aria-label={tn("crawlWebsite")}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] text-[var(--fg-secondary)] outline-none transition-colors hover:border-[var(--fg-secondary)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] disabled:opacity-40"
            >
              {isLoading ? (
                <IconLoader2
                  aria-hidden="true"
                  className="animate-spin"
                  size={18}
                />
              ) : (
                <IconArrowRight aria-hidden="true" size={18} />
              )}
            </button>
          </div>
          {error && (
            <p
              role="status"
              className="mb-0 mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-[var(--fg-secondary)]"
            >
              <IconAlertCircle
                aria-hidden="true"
                className="mt-0.5 shrink-0"
                size={14}
              />
              <span>{error}</span>
            </p>
          )}
        </form>

        <div className="my-5 flex items-center gap-3 text-[10px] font-medium uppercase tracking-widest text-[var(--fg-secondary)]">
          <span className="h-px flex-1 bg-[var(--docs-border)]" />
          {tn("or")}
          <span className="h-px flex-1 bg-[var(--docs-border)]" />
        </div>

        <button
          type="button"
          disabled
          className="mb-2 min-h-11 w-full rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] px-3 py-2.5 text-sm font-medium text-[var(--fg-secondary)] opacity-50"
        >
          {tn("uploadDesignReference")}
        </button>
        <button
          type="button"
          disabled
          className="min-h-11 w-full rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] px-3 py-2.5 text-sm font-medium text-[var(--fg-secondary)] opacity-50"
        >
          {tn("importDesignSystem")}
        </button>
        <a
          href="https://slides.agent-native.com/_agent-native/sign-in"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-11 items-center gap-1 text-xs text-[var(--fg-secondary)] underline-offset-2 outline-none hover:text-[var(--fg)] hover:underline focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]"
        >
          {tn("loginDesignSystems")}
          <IconExternalLink aria-hidden="true" size={13} />
        </a>
      </aside>

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
