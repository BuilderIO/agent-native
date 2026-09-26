
import { useMessageRuntime, useMessagePartText } from "@assistant-ui/react";
import { IconPlus, IconExternalLink } from "@tabler/icons-react";
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
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
  if (markdownModule !== null) return;
  void Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
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
      highlighterLoader = null;
      throw error;
    });
  }
  return highlighterLoader;
}


export const TextStreamingContext = React.createContext(false);
export const ExternalTextStreamingContext = React.createContext(false);

export const AgentRunActiveContext = React.createContext<boolean | undefined>(
  undefined,
);

export interface ActiveTextStreamingIdentity {
  runId: string | null;
  turnId: string | null;
}

export const ActiveTextStreamingIdentityContext =
  React.createContext<ActiveTextStreamingIdentity | null>(null);

export function AgentTextStreamingProvider({
  children,
  identity,
  streaming,
  runActive,
}: {
  children: React.ReactNode;
  identity: ActiveTextStreamingIdentity | null;
  streaming: boolean;
  runActive: boolean;
}) {
  return (
    <AgentRunActiveContext.Provider value={runActive}>
      <ActiveTextStreamingIdentityContext.Provider value={identity}>
        <TextStreamingContext.Provider value={streaming}>
          {children}
        </TextStreamingContext.Provider>
      </ActiveTextStreamingIdentityContext.Provider>
    </AgentRunActiveContext.Provider>
  );
}

function messageStreamingIdentity(
  message: unknown,
): ActiveTextStreamingIdentity {
  const metadata = (message as { metadata?: unknown })?.metadata as
    | {
        custom?: { runId?: unknown; turnId?: unknown };
        runId?: unknown;
        turnId?: unknown;
      }
    | undefined;
  return {
    runId:
      typeof metadata?.custom?.runId === "string"
        ? metadata.custom.runId
        : typeof metadata?.runId === "string"
          ? metadata.runId
          : null,
    turnId:
      typeof metadata?.custom?.turnId === "string"
        ? metadata.custom.turnId
        : typeof metadata?.turnId === "string"
          ? metadata.turnId
          : null,
  };
}

export function messageMatchesActiveTextStream(
  message: unknown,
  activeIdentity: ActiveTextStreamingIdentity | null,
): boolean {
  if (!activeIdentity) return false;
  const messageIdentity = messageStreamingIdentity(message);
  if (activeIdentity.turnId && messageIdentity.turnId) {
    return activeIdentity.turnId === messageIdentity.turnId;
  }
  return Boolean(
    activeIdentity.runId &&
    messageIdentity.runId &&
    activeIdentity.runId === messageIdentity.runId,
  );
}


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

function opensMarkdownLinkInNewTab(href: string | undefined): boolean {
  if (!href || typeof window === "undefined") return false;
  try {
    const url = new URL(href, window.location.href);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin !== window.location.origin
    );
  } catch {
    // coercion-ok: malformed links remain in the current tab and are not fetched here.
    return false;
  }
}

export function markdownUrlTransform(value: string): string {
  if (value === NEW_CHAT_ACTION_HREF) return value;
  if (!markdownModule) return value;
  return markdownModule.defaultUrlTransform(value);
}


export function extractCodeText(child: React.ReactNode): string {
  if (typeof child === "string") return child;
  if (Array.isArray(child)) return child.map(extractCodeText).join("");
  if (React.isValidElement(child)) {
    const props = child.props as { children?: React.ReactNode };
    return extractCodeText(props.children);
  }
  return "";
}


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
      const openInNewTab = opensMarkdownLinkInNewTab(href);
      return (
        <a
          href={href}
          target={openInNewTab ? "_blank" : undefined}
          rel={openInNewTab ? "noopener noreferrer" : undefined}
          className={className}
          {...rest}
        >
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
  const inputDoneRef = useRef(false);
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
      inputDone: inputDoneRef.current,
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

    const targetGraphemes = splitStreamingTextGraphemes(targetText);
    const shouldSettleBufferedText =
      !keyChanged &&
      !streaming &&
      !prefersReducedMotion &&
      visibleTextRef.current.length > 0 &&
      visibleTextRef.current !== targetText &&
      targetText.startsWith(visibleTextRef.current);

    if (shouldSettleBufferedText) {
      targetGraphemesRef.current = targetGraphemes;
      inputDoneRef.current = true;
      if (visibleCountRef.current < targetGraphemes.length) {
        scheduleFrame();
      }
      return;
    }

    if (!streaming || prefersReducedMotion) {
      cancelFrame();
      inputDoneRef.current = false;
      targetGraphemesRef.current = EMPTY_GRAPHEMES;
      visibleCountRef.current = 0;
      if (visibleTextRef.current !== targetText) {
        visibleTextRef.current = targetText;
        setVisibleText(targetText);
      }
      return;
    }

    targetGraphemesRef.current = targetGraphemes;
    inputDoneRef.current = false;

    const visibleNoLongerMatchesTarget =
      visibleTextRef.current.length > 0 &&
      !targetText.startsWith(visibleTextRef.current);

    if (
      keyChanged ||
      visibleNoLongerMatchesTarget ||
      visibleCountRef.current > targetGraphemes.length
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


export function StreamingText({
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
  animateStreaming?: boolean;
  onRevealComplete?: () => void;
}) {
  const mdReady = useMarkdownReady();
  const shouldAnimate = streaming && animateStreaming;
  const visibleText = useSmoothStreamingText(text, shouldAnimate, resetKey);
  const ReactMarkdown = markdownModule?.default;
  const gfm = remarkGfmFn;
  const markdownBlocks = useMemo(
    () => splitMarkdownBlocks(visibleText),
    [visibleText],
  );
  const renderedBlocks = useMemo(
    () =>
      markdownBlocks.tail
        ? [...markdownBlocks.completedBlocks, markdownBlocks.tail]
        : markdownBlocks.completedBlocks,
    [markdownBlocks],
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
        renderedBlocks.map((blockText, index) => (
          <MemoizedMarkdownBlock key={index} blockText={blockText} />
        ))
      ) : (
        <span style={{ whiteSpace: "pre-wrap" }}>{visibleText}</span>
      )}
    </div>
  );
}

/** @deprecated Use StreamingText for new AgentKit surfaces. */
export const SmoothMarkdownText = StreamingText;


export function shouldAnimateMarkdownText({
  textStreaming,
  isLastAssistantMessage,
  statusType,
  externalStreaming,
  activeMessageStreaming,
  runActive,
}: {
  textStreaming: boolean;
  isLastAssistantMessage: boolean;
  statusType: string;
  externalStreaming?: boolean;
  activeMessageStreaming?: boolean;
  runActive?: boolean;
}): boolean {
  const identityStreaming =
    activeMessageStreaming === true && runActive !== false;
  return (
    isLastAssistantMessage &&
    (identityStreaming ||
      (textStreaming &&
        (statusType === "running" || externalStreaming === true)))
  );
}

export function MarkdownText({ text: textOverride }: { text?: string } = {}) {
  const t = useT();
  const textPart = useMessagePartText();
  const messageRuntime = useMessageRuntime();
  const message = messageRuntime.getState();
  const textStreaming = React.useContext(TextStreamingContext);
  const externalStreaming = React.useContext(ExternalTextStreamingContext);
  const runActive = React.useContext(AgentRunActiveContext);
  const activeStreamingIdentity = React.useContext(
    ActiveTextStreamingIdentityContext,
  );
  const isLastAssistantMessage = message.role === "assistant" && message.isLast;
  const statusType =
    textPart.status?.type ?? message.status?.type ?? "complete";

  return (
    <StreamingText
      text={localizeKnownChatErrorText(textOverride ?? textPart.text, t)}
      streaming={shouldAnimateMarkdownText({
        textStreaming,
        isLastAssistantMessage,
        statusType,
        externalStreaming,
        activeMessageStreaming: messageMatchesActiveTextStream(
          message,
          activeStreamingIdentity,
        ),
        runActive,
      })}
      resetKey={message.id}
      statusType={statusType}
    />
  );
}
