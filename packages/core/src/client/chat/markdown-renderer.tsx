// Owns: lazy react-markdown/shiki loaders, SmoothMarkdownText, MarkdownText,
// HighlightedCodeBlock wrapper, and the markdownComponents/markdownUrlTransform
// used by every markdown render path in AssistantChat.

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  useThread,
  useMessageRuntime,
  useMessagePartText,
} from "@assistant-ui/react";
// react-markdown + remark-gfm type imports only — loaded lazily below.
import type { default as ReactMarkdownType } from "react-markdown";
import type { defaultUrlTransform as DefaultUrlTransformType } from "react-markdown";
import type remarkGfmType from "remark-gfm";
import {
  initialSmoothStreamingGraphemeCount,
  SMOOTH_STREAMING_COMMIT_INTERVAL_MS,
  smoothStreamingPunctuationDelayMs,
  smoothStreamingRevealCount,
  splitStreamingTextGraphemes,
} from "../../shared/streaming-text-smoothing.js";
import { splitMarkdownBlocks } from "../../shared/markdown-block-split.js";
import { HighlightedCodeBlock as SharedHighlightedCodeBlock } from "../HighlightedCodeBlock.js";
import { IframeEmbed, parseEmbedBody } from "../IframeEmbed.js";
import { cn } from "../utils.js";
import {
  NEW_CHAT_ACTION_HREF,
  BUILDER_SPACE_SETTINGS_URL,
} from "../error-format.js";
import { IconPlus, IconExternalLink } from "@tabler/icons-react";

// ─── Lazy markdown loader ────────────────────────────────────────────────────
// react-markdown + remark-gfm are deferred so they stay off the critical path
// of every page. The loader fires as soon as this module is evaluated (i.e.
// when the lazy AssistantChat chunk lands — not at initial page parse).
// This mirrors the existing shiki lazy-load pattern further below.

type ReactMarkdownModule = {
  default: typeof ReactMarkdownType;
  defaultUrlTransform: typeof DefaultUrlTransformType;
};

export let markdownModule: ReactMarkdownModule | null = null;
export let remarkGfmFn: typeof remarkGfmType | null = null;
const markdownListeners = new Set<() => void>();

export function loadMarkdown(): void {
  if (markdownModule !== null) return; // already loaded
  Promise.all([import("react-markdown"), import("remark-gfm")]).then(
    ([md, gfm]) => {
      markdownModule = md as ReactMarkdownModule;
      remarkGfmFn = gfm.default;
      markdownListeners.forEach((fn) => fn());
      markdownListeners.clear();
    },
  );
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
      url.href === BUILDER_SPACE_SETTINGS_URL ||
      url.pathname === "/account/billing" ||
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
      const langMatch = className.match(/\blanguage-([\w+-]+)\b/);
      if (langMatch) {
        const code = extractCodeText(childProps.children).replace(/\n$/, "");
        return <HighlightedCodeBlock code={code} lang={langMatch[1]} />;
      }
    }
    return <pre {...rest}>{children}</pre>;
  },
};

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

export function useSmoothStreamingText(
  targetText: string,
  streaming: boolean,
  resetKey: string,
): string {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [visibleText, setVisibleText] = useState(() => {
    if (!streaming || prefersReducedMotion) return targetText;
    const graphemes = splitStreamingTextGraphemes(targetText);
    return sliceGraphemes(
      targetText,
      graphemes,
      initialSmoothStreamingGraphemeCount(graphemes),
    );
  });
  const visibleTextRef = useRef(visibleText);
  const visibleCountRef = useRef(
    splitStreamingTextGraphemes(visibleText).length,
  );
  const targetTextRef = useRef(targetText);
  const targetGraphemesRef = useRef(splitStreamingTextGraphemes(targetText));
  const frameRef = useRef<number | null>(null);
  const lastCommitAtRef = useRef(0);
  const pauseUntilRef = useRef(0);
  const resetKeyRef = useRef(resetKey);
  const stepRef = useRef<(time: number) => void>(() => {});

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
    const targetGraphemes = splitStreamingTextGraphemes(targetText);
    targetTextRef.current = targetText;
    targetGraphemesRef.current = targetGraphemes;

    const keyChanged = resetKeyRef.current !== resetKey;
    resetKeyRef.current = resetKey;

    if (!streaming || prefersReducedMotion) {
      cancelFrame();
      commitVisibleCount(targetGraphemes.length);
      return;
    }

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

// ─── MemoizedMarkdownBlock ────────────────────────────────────────────────────
// Renders a single stable markdown block. Wrapped in React.memo so React
// skips re-rendering completed blocks when only the tail changes.

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
      {blockText}
    </ReactMarkdown>
  );
});

// ─── SmoothMarkdownText ────────────────────────────────────────────────────────

export function SmoothMarkdownText({
  text,
  streaming,
  resetKey,
  statusType = "complete",
}: {
  text: string;
  streaming: boolean;
  resetKey: string;
  statusType?: string;
}) {
  const mdReady = useMarkdownReady();
  const visibleText = useSmoothStreamingText(text, streaming, resetKey);
  const isVisuallyStreaming = streaming && visibleText !== text;
  const ReactMarkdown = markdownModule?.default;
  const gfm = remarkGfmFn;

  // Block-memoized rendering: during streaming split the visible text into
  // stable completed blocks + an in-progress tail.  Only the tail re-renders
  // on every commit; completed blocks are React.memo'd and skipped.
  // On completion we fall through to a single ReactMarkdown pass to guarantee
  // byte-identical final output (no block-split artifacts).
  const split = useMemo(
    () => (isVisuallyStreaming ? splitMarkdownBlocks(visibleText) : null),
    [isVisuallyStreaming, visibleText],
  );

  return (
    <div
      className="agent-markdown break-words"
      data-status={statusType}
      data-streaming={isVisuallyStreaming ? "true" : undefined}
    >
      {mdReady && ReactMarkdown && gfm ? (
        split ? (
          // Streaming: render completed blocks (memoized) + live tail block
          <>
            {split.completedBlocks.map((block, i) => (
              <MemoizedMarkdownBlock key={i} blockText={block} />
            ))}
            {split.tail ? (
              <ReactMarkdown
                remarkPlugins={[gfm]}
                components={markdownComponents}
                urlTransform={markdownUrlTransform}
              >
                {split.tail}
              </ReactMarkdown>
            ) : null}
          </>
        ) : (
          // Not streaming (or streaming complete): single-pass render
          <ReactMarkdown
            remarkPlugins={[gfm]}
            components={markdownComponents}
            urlTransform={markdownUrlTransform}
          >
            {visibleText}
          </ReactMarkdown>
        )
      ) : (
        // Plain text while the react-markdown chunk is in flight.
        // The chunk is already being fetched by loadMarkdown() above, so
        // this placeholder is typically only visible for one render frame.
        <span style={{ whiteSpace: "pre-wrap" }}>{visibleText}</span>
      )}
    </div>
  );
}

// ─── MarkdownText ──────────────────────────────────────────────────────────────

export function MarkdownText() {
  const textPart = useMessagePartText();
  const messageRuntime = useMessageRuntime();
  const message = messageRuntime.getState();
  const thread = useThread();
  const textStreaming = React.useContext(TextStreamingContext);
  const lastMessage = thread.messages[thread.messages.length - 1];
  const isLastAssistantMessage =
    message.role === "assistant" && lastMessage?.id === message.id;
  const statusType =
    textPart.status?.type ?? message.status?.type ?? "complete";

  return (
    <SmoothMarkdownText
      text={textPart.text}
      streaming={textStreaming && isLastAssistantMessage}
      resetKey={`${message.id}:${statusType}`}
      statusType={statusType}
    />
  );
}
