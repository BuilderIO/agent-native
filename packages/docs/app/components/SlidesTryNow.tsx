import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowRight,
  IconExternalLink,
  IconLoader2,
  IconPalette,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

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

  function streamStyleGuide(reference: DesignReference, sourceUrl: string) {
    const editor = editorRef.current;
    if (!editor) return;

    const subject = [reference.title, reference.description]
      .filter(Boolean)
      .join(", ");
    if (subject) replaceSubjectPlaceholder(editor, subject);

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
    const displayUrl = new URL(sourceUrl).hostname.replace(/^www\./i, "");
    const hasTitle =
      Boolean(reference.title) &&
      reference.title.toLowerCase() !== displayUrl.toLowerCase();
    const header = hasTitle
      ? `${reference.title} (${displayUrl})${
          reference.description ? `, — ${reference.description}` : ""
        }`
      : `${displayUrl}${reference.description ? ` — ${reference.description}` : ""}`;
    const text = `${tn("styleGuidePrefix")} ${header}${
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
          target.textContent = `${tn("styleGuidePrefix")} ${header}\n${tn("findingColors")}: `;
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
      streamStyleGuide(reference, safeUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tn("crawlError"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 text-start lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
      <aside className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
        <div className="mb-4 flex items-center gap-2">
          <IconPalette size={18} stroke={1.8} />
          <h3 className="m-0 text-sm font-semibold">{tn("designReference")}</h3>
        </div>
        <form onSubmit={handleReferenceSubmit}>
          <label
            htmlFor="slides-design-reference-url"
            className="mb-2 block text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]"
          >
            {tn("websiteUrl")}
          </label>
          <div className="relative">
            <input
              id="slides-design-reference-url"
              type="text"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={tn("websiteUrlPlaceholder")}
              disabled={isLoading}
              className="w-full rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] py-2.5 ps-3 pe-10 text-sm text-[var(--fg)] outline-none transition placeholder:text-[var(--fg-secondary)] focus:border-[var(--docs-accent)] disabled:opacity-70"
            />
            <button
              type="submit"
              disabled={!url.trim() || isLoading}
              aria-label={tn("crawlWebsite")}
              className="absolute end-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--fg-secondary)] transition hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)] disabled:opacity-40"
            >
              {isLoading ? (
                <IconLoader2 className="animate-spin" size={16} />
              ) : (
                <IconArrowRight size={16} />
              )}
            </button>
          </div>
          {error && (
            <p className="mb-0 mt-2 text-xs text-red-600 dark:text-red-400">
              {error}
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
          className="mb-2 w-full rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] px-3 py-2.5 text-sm font-medium text-[var(--fg-secondary)] opacity-50"
        >
          {tn("uploadDesignReference")}
        </button>
        <button
          type="button"
          disabled
          className="w-full rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] px-3 py-2.5 text-sm font-medium text-[var(--fg-secondary)] opacity-50"
        >
          {tn("importDesignSystem")}
        </button>
        <a
          href="https://slides.agent-native.com/_agent-native/sign-in"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--fg-secondary)] underline-offset-2 hover:text-[var(--fg)] hover:underline"
        >
          {tn("loginDesignSystems")}
          <IconExternalLink size={13} />
        </a>
      </aside>

      <div className="flex min-h-[22rem] flex-col gap-3 rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5 sm:p-6">
        <label
          htmlFor="slides-try-now-prompt"
          className="text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]"
        >
          {tn("composerLabel")}
        </label>
        <div
          ref={editorRef}
          id="slides-try-now-prompt"
          role="textbox"
          aria-multiline="true"
          contentEditable
          suppressContentEditableWarning
          onKeyDown={handlePromptKeyDown}
          className="min-h-48 w-full flex-1 rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-4 text-sm leading-8 text-[var(--fg)] outline-none transition focus:border-[var(--docs-accent)]"
        >
          {tn("promptCreatePrefix")}{" "}
          <select
            defaultValue="capital-raise"
            aria-label={tn("deckTypeLabel")}
            className="rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-2 py-1 text-sm font-medium text-[var(--fg)]"
            contentEditable={false}
          >
            <option value="capital-raise">{tn("deckCapitalRaise")}</option>
            <option value="b2b-sales">{tn("deckB2bSales")}</option>
            <option value="live-talk">{tn("deckLiveTalk")}</option>
          </select>{" "}
          {tn("promptDeckFor")} {SUBJECT_PLACEHOLDER}.{" "}
          {tn("promptTextShouldBe")}{" "}
          <select
            defaultValue="brief"
            aria-label={tn("textAmountLabel")}
            className="rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-2 py-1 text-sm font-medium text-[var(--fg)]"
            contentEditable={false}
          >
            <option value="minimal">{tn("textMinimal")}</option>
            <option value="brief">{tn("textBrief")}</option>
            <option value="thorough">{tn("textThorough")}</option>
          </select>
          .
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            {tn("submit")}
            <IconArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
