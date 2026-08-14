// Owns: lazy react-markdown/shiki loaders, SmoothMarkdownText, MarkdownText,
// HighlightedCodeBlock wrapper, and the markdownComponents/markdownUrlTransform
// used by every markdown render path in AssistantChat.

import { useMessageRuntime, useMessagePartText } from "@assistant-ui/react";
import { IconPlus, IconExternalLink } from "@tabler/icons-react";
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
// react-markdown + remark-gfm type imports only — loaded lazily below.
import type { default as ReactMarkdownType } from "react-markdown";
import type { defaultUrlTransform as DefaultUrlTransformType } from "react-markdown";
import type remarkGfmType from "remark-gfm";

import { splitMarkdownBlocks } from "../../shared/markdown-block-split.js";
import {
  initialSmoothStreamingGraphemeCount,
  SMOOTH_STREAMING_COMMIT_INTERVAL_MS,
  smoothStreamingPunctuationDelayMs,
  smoothStreamingRevealCount,
  splitStreamingTextGraphemes,
} from "../../shared/streaming-text-smoothing.js";
import {
  localizeKnownChatErrorText,
  NEW_CHAT_ACTION_HREF,
} from "../error-format.js";
import { HighlightedCodeBlock as SharedHighlightedCodeBlock } from "../HighlightedCodeBlock.js";
import { useT } from "../i18n.js";
import { IframeEmbed, parseEmbedBody } from "../IframeEmbed.js";
import { cn } from "../utils.js";
import {
  LEGACY_CHART_SHORTHAND_LANG,
  LegacyChartShorthandChart,
  LegacyChartShorthandFallback,
  parseLegacyChartShorthand,
  wrapLegacyChartShorthandLines,
} from "./legacy-chart-shorthand.js";

// ─── Lazy markdown loader ────────────────────────────────────────────────────
// react-markdown + remark-gfm are deferred so they stay off the critical path
// of every page. The loader fires as soon as this module is evaluated (i.e.
// when the lazy AssistantChat chunk lands — not at initial page parse).
// This mirrors the existing shiki lazy-load pattern further below.

type ReactMarkdownModule = {
  default: typeof ReactMarkdownType;
  defaultUrlTransform: typeof DefaultUrlTransformType;
};

type RenderToStaticMarkupFn = (node: React.ReactElement) => string;

export let markdownModule: ReactMarkdownModule | null = null;
export let remarkGfmFn: typeof remarkGfmType | null = null;
let renderToStaticMarkupFn: RenderToStaticMarkupFn | null = null;
const markdownListeners = new Set<() => void>();

export function loadMarkdown(): void {
  if (markdownModule !== null) return; // already loaded
  Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
    // react-dom/server powers the synchronous markdown→HTML string used for
    // rich clipboard copy; loaded alongside so readiness stays a single gate.
    import("react-dom/server"),
  ]).then(([md, gfm, server]) => {
    markdownModule = md as ReactMarkdownModule;
    remarkGfmFn = gfm.default;
    renderToStaticMarkupFn = (
      server as { renderToStaticMarkup: RenderToStaticMarkupFn }
    ).renderToStaticMarkup;
    markdownListeners.forEach((fn) => fn());
    markdownListeners.clear();
  });
}

export function onMarkdownReady(fn: () => void): () => void {
  if (markdownModule !== null) {
    fn();
    return () => {};
  }
  markdownListeners.add(fn);
  return () => markdownListeners.delete(fn);
}

loadMarkdown();

// ─── Lazy shiki highlighter ──────────────────────────────────────────────────
// Using the fine-grained API so we only ship the languages and themes we
// actually use (instead of shiki's full ~30 MB bundle of every grammar).
// Required to keep the Cloudflare Pages Functions bundle under 25 MiB.

type ShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: {
      lang: string;
      themes: { light: string; dark: string };
      defaultColor?: false | "light" | "dark";
    },
  ) => string | Promise<string>;
  getLoadedLanguages: () => string[];
};

let highlighterLoader: Promise<ShikiHighlighter> | null = null;
export function loadHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterLoader) {
    highlighterLoader = (async () => {
      // Use the JavaScript regex engine instead of Oniguruma WASM (~608 KB saved).
      // forgiving:true degrades unsupported patterns gracefully instead of throwing.
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/javascript"),
        ]);
      return createHighlighterCore({
        themes: [
          import("shiki/themes/github-light-default.mjs"),
          import("shiki/themes/github-dark-default.mjs"),
        ],
        langs: [
          import("shiki/langs/javascript.mjs"),
          import("shiki/langs/typescript.mjs"),
          import("shiki/langs/jsx.mjs"),
          import("shiki/langs/tsx.mjs"),
          import("shiki/langs/json.mjs"),
          import("shiki/langs/css.mjs"),
          import("shiki/langs/html.mjs"),
          import("shiki/langs/markdown.mjs"),
          import("shiki/langs/bash.mjs"),
          import("shiki/langs/shellscript.mjs"),
          import("shiki/langs/python.mjs"),
          import("shiki/langs/yaml.mjs"),
          import("shiki/langs/sql.mjs"),
        ],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      }) as unknown as Promise<ShikiHighlighter>;
    })().catch((error) => {
      // Reset on failure so a future code block can retry instead of
      // silently failing forever on a stale chunk / network blip.
      highlighterLoader = null;
      throw error;
    });
  }
  return highlighterLoader;
}

// ─── Streaming context ───────────────────────────────────────────────────────
// Declared at module level so HighlightedCodeBlock (used in markdownComponents
// below) can read the current streaming state without the components object
// needing to be rebuilt on every render.

export const TextStreamingContext = React.createContext(false);

// ─── HighlightedCodeBlock wrapper ────────────────────────────────────────────
// Reads streaming state from context so markdownComponents (a static constant)
// can opt into debounced highlighting without needing to rebuild on every render.

export function HighlightedCodeBlock({
  code,
  lang,
}: {
  code: string;
  lang: string;
}) {
  const streaming = React.useContext(TextStreamingContext);
  return (
    <SharedHighlightedCodeBlock
      code={code}
      lang={lang}
      containerClass="agent-markdown-shiki"
      streaming={streaming}
      loadHighlighter={loadHighlighter}
    />
  );
}

// ─── CTA helpers ─────────────────────────────────────────────────────────────

const CTA_BUTTON_CLASSES =
  "agent-markdown-cta mt-1 inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background no-underline shadow-sm transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer";

function isBuilderErrorCtaHref(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || url.hostname !== "builder.io") {
      return false;
    }
    return (
      (url.origin === "https://builder.io" &&
        url.pathname === "/account/space") ||
      url.pathname === "/account/billing" ||
      url.pathname === "/account/subscription" ||
      /^\/app\/organizations\/[^/]+\/billing$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

// react-markdown's defaultUrlTransform strips href values whose protocol
// isn't on its safe list (https, mailto, etc.). Our in-app pseudo-href
// `agent-native:new-chat` would be blanked out by that, so let it through
// while delegating every other URL to the default transform for sanitization.
// Falls back to the value unchanged when the react-markdown module hasn't
// landed yet (conservative: no stripping beats an empty href).
export function markdownUrlTransform(value: string): string {
  if (value === NEW_CHAT_ACTION_HREF) return value;
  if (!markdownModule) return value;
  return markdownModule.defaultUrlTransform(value);
}

// ─── Code text extraction ─────────────────────────────────────────────────────

export function extractCodeText(child: React.ReactNode): string {
  if (typeof child === "string") return child;
  if (Array.isArray(child)) return child.map(extractCodeText).join("");
  if (React.isValidElement(child)) {
    const props = child.props as { children?: React.ReactNode };
    return extractCodeText(props.children);
  }
  return "";
}

// ─── Markdown components ──────────────────────────────────────────────────────

export const markdownComponents = {
  a(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    const {
      href,
      children,
      className,
      rel: _rel,
      target: _target,
      ...rest
    } = props;
    if (href === NEW_CHAT_ACTION_HREF) {
      // In-app action: dispatch a CustomEvent that MultiTabAssistantChat
      // listens for and opens a new chat tab. Not an external navigation.
      return (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("agent-chat:new-chat"));
          }}
          className={cn(CTA_BUTTON_CLASSES, className)}
        >
          <IconPlus size={13} strokeWidth={2} aria-hidden="true" />
          <span>{children}</span>
        </button>
      );
    }
    const isBuilderCta = isBuilderErrorCtaHref(href);
    if (!isBuilderCta) {
      return (
        <a href={href} className={className} {...rest}>
          {children}
        </a>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cn(CTA_BUTTON_CLASSES, className)}
        {...rest}
      >
        <span>{children}</span>
        <IconExternalLink size={13} strokeWidth={2} aria-hidden="true" />
      </a>
    );
  },
  table(props: React.TableHTMLAttributes<HTMLTableElement>) {
    const { children, ...rest } = props;
    return (
      <div className="agent-markdown-table-wrap">
        <table {...rest}>{children}</table>
      </div>
    );
  },
  pre(props: React.HTMLAttributes<HTMLPreElement>) {
    const { children, ...rest } = props;
    if (React.isValidElement(children)) {
      const childProps = children.props as {
        className?: string;
        children?: React.ReactNode;
      };
      const className = childProps.className || "";
      if (/\blanguage-embed\b/.test(className)) {
        const body = extractCodeText(childProps.children);
        const parsed = parseEmbedBody(body);
        return (
          <IframeEmbed {...(parsed as Parameters<typeof IframeEmbed>[0])} />
        );
      }
      if (
        new RegExp(`\\blanguage-${LEGACY_CHART_SHORTHAND_LANG}\\b`).test(
          className,
        )
      ) {
        const body = extractCodeText(childProps.children).replace(/\n$/, "");
        const parsed = parseLegacyChartShorthand(body);
        return parsed ? (
          <LegacyChartShorthandChart parsed={parsed} />
        ) : (
          <LegacyChartShorthandFallback text={body} />
        );
      }
      const langMatch = className.match(/\blanguage-([\w+-]+)\b/);
      if (langMatch) {
        const code = extractCodeText(childProps.children).replace(/\n$/, "");
        return <HighlightedCodeBlock code={code} lang={langMatch[1]} />;
      }
    }
    return <pre {...rest}>{children}</pre>;
  },
};

// ─── Clipboard HTML rendering ─────────────────────────────────────────────────
// A stripped component set for the `text/html` clipboard flavor: plain <a> and
// <pre>/<code> with no in-app buttons, iframes, or syntax-highlight markup, so
// pasted output is portable structure (bold, lists, links, code) rather than
// app-specific chrome that receiving apps (Slack, Notion) discard anyway.

const clipboardMarkdownComponents = {
  a(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    const { href, children } = props;
    if (href === NEW_CHAT_ACTION_HREF || !href) return <span>{children}</span>;
    return <a href={href}>{children}</a>;
  },
  pre(props: React.HTMLAttributes<HTMLPreElement>) {
    return <pre>{props.children}</pre>;
  },
};

// Renders joined message markdown to an HTML string for rich clipboard copy.
// Returns null when the lazy markdown/react-dom-server modules haven't landed
// yet; callers fall back to plain-text copy in that case.
export function renderMarkdownToClipboardHtml(markdown: string): string | null {
  const ReactMarkdown = markdownModule?.default;
  const gfm = remarkGfmFn;
  const renderToStaticMarkup = renderToStaticMarkupFn;
  if (!ReactMarkdown || !gfm || !renderToStaticMarkup) return null;
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[gfm]}
      components={clipboardMarkdownComponents}
      urlTransform={markdownUrlTransform}
    >
      {markdown}
    </ReactMarkdown>,
  );
}

// ─── Smooth streaming ─────────────────────────────────────────────────────────

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setPrefersReducedMotion(media.matches);
    handleChange();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  return prefersReducedMotion;
}

function sliceGraphemes(
  targetText: string,
  graphemes: readonly string[],
  count: number,
): string {
  if (count >= graphemes.length) return targetText;
  if (count <= 0) return "";
  return graphemes.slice(0, count).join("");
}

type SmoothStreamingTextCacheEntry = {
  targetText: string;
  visibleText: string;
};

// Grouped message parts are rebuilt as tool calls arrive. A text part can
// therefore be unmounted and mounted again even though its identity did not
// change. Keep the reveal cursor outside that subtree so a structural update
// continues from the current cursor instead of replaying the opening sentence.
const smoothStreamingTextCache = new Map<
  string,
  SmoothStreamingTextCacheEntry
>();

function cachedStreamingText(
  resetKey: string,
  targetText: string,
): string | undefined {
  const cached = smoothStreamingTextCache.get(resetKey);
  if (!cached) return undefined;
  if (
    !targetText.startsWith(cached.targetText) ||
    !targetText.startsWith(cached.visibleText)
  ) {
    return undefined;
  }
  return cached.visibleText;
}

function rememberStreamingText(
  resetKey: string,
  targetText: string,
  visibleText: string,
): void {
  smoothStreamingTextCache.delete(resetKey);
  smoothStreamingTextCache.set(resetKey, { targetText, visibleText });
  if (smoothStreamingTextCache.size <= 128) return;
  const oldestKey = smoothStreamingTextCache.keys().next().value;
  if (oldestKey !== undefined) smoothStreamingTextCache.delete(oldestKey);
}

/** Stable placeholder so the grapheme ref stays `string[]` before it is seeded. */
const EMPTY_GRAPHEMES: string[] = [];

export function useSmoothStreamingText(
  targetText: string,
  streaming: boolean,
  resetKey: string,
): string {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [visibleText, setVisibleText] = useState(() => {
    if (!streaming || prefersReducedMotion) return targetText;
    const cachedText = cachedStreamingText(resetKey, targetText);
    if (cachedText !== undefined) return cachedText;
    const graphemes = splitStreamingTextGraphemes(targetText);
    return sliceGraphemes(
      targetText,
      graphemes,
      initialSmoothStreamingGraphemeCount(graphemes),
    );
  });
  const visibleTextRef = useRef(visibleText);
  const targetTextRef = useRef(targetText);
  // `useRef(expr)` evaluates `expr` on EVERY render and throws it away after
  // mount. Segmenting here therefore ran a full Intl.Segmenter pass per commit
  // — up to 60Hz per streaming message — and, because `visibleText` is a strict
  // prefix of `targetText`, that pass could never hit the incremental path and
  // evicted the shared segmenter cache for every other live stream too. Seed
  // once; the streaming effect below keeps both refs authoritative after that.
  const visibleCountRef = useRef(-1);
  const targetGraphemesRef = useRef<string[]>(EMPTY_GRAPHEMES);
  if (visibleCountRef.current < 0) {
    if (streaming && !prefersReducedMotion) {
      targetGraphemesRef.current = splitStreamingTextGraphemes(targetText);
      visibleCountRef.current = splitStreamingTextGraphemes(visibleText).length;
    } else {
      visibleCountRef.current = 0;
    }
  }
  const frameRef = useRef<number | null>(null);
  const lastCommitAtRef = useRef(0);
  const pauseUntilRef = useRef(0);
  const resetKeyRef = useRef(resetKey);
  const cacheKeyRef = useRef(resetKey);
  const cacheStreamingRef = useRef(streaming);
  const cacheReducedMotionRef = useRef(prefersReducedMotion);
  const stepRef = useRef<(time: number) => void>(() => {});

  cacheKeyRef.current = resetKey;
  cacheStreamingRef.current = streaming;
  cacheReducedMotionRef.current = prefersReducedMotion;

  const commitVisibleCount = useCallback((nextCount: number) => {
    const graphemes = targetGraphemesRef.current;
    const boundedCount = Math.max(0, Math.min(nextCount, graphemes.length));
    const nextText = sliceGraphemes(
      targetTextRef.current,
      graphemes,
      boundedCount,
    );
    visibleCountRef.current = boundedCount;
    if (visibleTextRef.current !== nextText) {
      visibleTextRef.current = nextText;
      setVisibleText(nextText);
    }
    if (cacheStreamingRef.current && !cacheReducedMotionRef.current) {
      rememberStreamingText(
        cacheKeyRef.current,
        targetTextRef.current,
        nextText,
      );
    }
  }, []);

  const cancelFrame = useCallback(() => {
    if (
      frameRef.current != null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = null;
    pauseUntilRef.current = 0;
  }, []);

  const scheduleFrame = useCallback(() => {
    if (frameRef.current != null) return;
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      commitVisibleCount(targetGraphemesRef.current.length);
      return;
    }

    frameRef.current = window.requestAnimationFrame((time) => {
      frameRef.current = null;
      stepRef.current(time);
    });
  }, [commitVisibleCount]);

  stepRef.current = (time) => {
    const targetGraphemes = targetGraphemesRef.current;
    const backlog = targetGraphemes.length - visibleCountRef.current;
    if (backlog <= 0) {
      pauseUntilRef.current = 0;
      return;
    }

    if (pauseUntilRef.current > time) {
      scheduleFrame();
      return;
    }

    const lastCommitAt =
      lastCommitAtRef.current || time - SMOOTH_STREAMING_COMMIT_INTERVAL_MS;
    if (
      time - lastCommitAt < SMOOTH_STREAMING_COMMIT_INTERVAL_MS &&
      backlog > 1
    ) {
      scheduleFrame();
      return;
    }

    const revealCount = smoothStreamingRevealCount({
      backlog,
      elapsedMs: Math.min(120, Math.max(8, time - lastCommitAt)),
    });

    if (revealCount > 0) {
      const nextCount = visibleCountRef.current + revealCount;
      commitVisibleCount(nextCount);
      lastCommitAtRef.current = time;
      const nextBacklog = targetGraphemes.length - visibleCountRef.current;
      const pauseMs = smoothStreamingPunctuationDelayMs(
        targetGraphemes[visibleCountRef.current - 1],
        nextBacklog,
      );
      pauseUntilRef.current = pauseMs > 0 ? time + pauseMs : 0;
    }

    if (visibleCountRef.current < targetGraphemes.length) {
      scheduleFrame();
    } else {
      pauseUntilRef.current = 0;
    }
  };

  useEffect(() => {
    targetTextRef.current = targetText;

    const keyChanged = resetKeyRef.current !== resetKey;
    resetKeyRef.current = resetKey;

    if (!streaming || prefersReducedMotion) {
      cancelFrame();
      targetGraphemesRef.current = EMPTY_GRAPHEMES;
      visibleCountRef.current = 0;
      if (visibleTextRef.current !== targetText) {
        visibleTextRef.current = targetText;
        setVisibleText(targetText);
      }
      return;
    }

    const targetGraphemes = splitStreamingTextGraphemes(targetText);
    targetGraphemesRef.current = targetGraphemes;

    const visibleNoLongerMatchesTarget =
      visibleTextRef.current.length > 0 &&
      !targetText.startsWith(visibleTextRef.current);

    if (
      visibleNoLongerMatchesTarget ||
      visibleCountRef.current > targetGraphemes.length ||
      (keyChanged && visibleTextRef.current.length === 0)
    ) {
      commitVisibleCount(initialSmoothStreamingGraphemeCount(targetGraphemes));
      lastCommitAtRef.current = 0;
      pauseUntilRef.current = 0;
    }

    if (visibleCountRef.current < targetGraphemes.length) {
      scheduleFrame();
    }
  }, [
    targetText,
    streaming,
    prefersReducedMotion,
    resetKey,
    cancelFrame,
    commitVisibleCount,
    scheduleFrame,
  ]);

  useEffect(() => {
    if (!streaming || prefersReducedMotion) return;
    rememberStreamingText(resetKey, targetText, visibleText);
  }, [prefersReducedMotion, resetKey, streaming, targetText, visibleText]);

  // When the tab returns from background, rAF has been paused and the backlog
  // may be tens of thousands of characters. Animating from where we left off
  // would replay minutes of content at the normal rate — instead jump the
  // cursor to near the tail so only the final ~200 graphemes animate in.
  // Reduced-motion users already get instant reveals (handled above), so this
  // guard only applies to the normal animation path.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (!streaming || prefersReducedMotion) return;
      const graphemes = targetGraphemesRef.current;
      const backlog = graphemes.length - visibleCountRef.current;
      const BACKGROUND_CATCH_UP_THRESHOLD = 2000;
      const BACKGROUND_TAIL_GRAPHEMES = 200;
      if (backlog > BACKGROUND_CATCH_UP_THRESHOLD) {
        commitVisibleCount(
          Math.max(0, graphemes.length - BACKGROUND_TAIL_GRAPHEMES),
        );
        lastCommitAtRef.current = 0;
        pauseUntilRef.current = 0;
        scheduleFrame();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [streaming, prefersReducedMotion, commitVisibleCount, scheduleFrame]);

  useEffect(() => cancelFrame, [cancelFrame]);

  return visibleText;
}

// ─── Markdown readiness hook ──────────────────────────────────────────────────

export function useMarkdownReady(): boolean {
  const [ready, setReady] = useState(() => markdownModule !== null);
  useEffect(() => {
    if (markdownModule !== null) return;
    return onMarkdownReady(() => setReady(true));
  }, []);
  return ready;
}

export const MemoizedMarkdownBlock = React.memo(function MemoizedMarkdownBlock({
  blockText,
}: {
  blockText: string;
}) {
  const ReactMarkdown = markdownModule?.default;
  const gfm = remarkGfmFn;
  if (!ReactMarkdown || !gfm) return null;
  return (
    <ReactMarkdown
      remarkPlugins={[gfm]}
      components={markdownComponents}
      urlTransform={markdownUrlTransform}
    >
      {wrapLegacyChartShorthandLines(blockText)}
    </ReactMarkdown>
  );
});

// ─── SmoothMarkdownText ────────────────────────────────────────────────────────

export function SmoothMarkdownText({
  text,
  streaming,
  resetKey,
  statusType = "complete",
  animateStreaming = true,
  onRevealComplete,
}: {
  text: string;
  streaming: boolean;
  resetKey: string;
  statusType?: string;
  /** Allow callers to opt out for static or deliberately chunk-native surfaces. */
  animateStreaming?: boolean;
  onRevealComplete?: () => void;
}) {
  const mdReady = useMarkdownReady();
  const shouldAnimate = streaming && animateStreaming;
  const visibleText = useSmoothStreamingText(text, shouldAnimate, resetKey);
  const ReactMarkdown = markdownModule?.default;
  const gfm = remarkGfmFn;
  const markdownBlocks = useMemo(
    () => (streaming ? splitMarkdownBlocks(visibleText) : null),
    [streaming, visibleText],
  );

  useEffect(() => {
    if (!onRevealComplete || !shouldAnimate || visibleText !== text) return;
    onRevealComplete();
  }, [onRevealComplete, shouldAnimate, text, visibleText]);

  return (
    <div
      className="agent-markdown break-words"
      data-status={statusType}
      data-streaming={streaming ? "true" : undefined}
    >
      {mdReady && ReactMarkdown && gfm ? (
        markdownBlocks ? (
          <>
            {markdownBlocks.completedBlocks.map((blockText, index) => (
              <MemoizedMarkdownBlock key={index} blockText={blockText} />
            ))}
            {markdownBlocks.tail ? (
              <ReactMarkdown
                remarkPlugins={[gfm]}
                components={markdownComponents}
                urlTransform={markdownUrlTransform}
              >
                {wrapLegacyChartShorthandLines(markdownBlocks.tail)}
              </ReactMarkdown>
            ) : null}
          </>
        ) : (
          <ReactMarkdown
            remarkPlugins={[gfm]}
            components={markdownComponents}
            urlTransform={markdownUrlTransform}
          >
            {wrapLegacyChartShorthandLines(visibleText)}
          </ReactMarkdown>
        )
      ) : (
        <span style={{ whiteSpace: "pre-wrap" }}>{visibleText}</span>
      )}
    </div>
  );
}

// ─── MarkdownText ──────────────────────────────────────────────────────────────

export function MarkdownText() {
  const t = useT();
  const textPart = useMessagePartText();
  const messageRuntime = useMessageRuntime();
  const message = messageRuntime.getState();
  const textStreaming = React.useContext(TextStreamingContext);
  const isLastAssistantMessage = message.role === "assistant" && message.isLast;
  const statusType =
    textPart.status?.type ?? message.status?.type ?? "complete";

  return (
    <SmoothMarkdownText
      text={localizeKnownChatErrorText(textPart.text, t)}
      streaming={textStreaming && isLastAssistantMessage}
      resetKey={message.id}
      statusType={statusType}
    />
  );
}
