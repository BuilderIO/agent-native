// Owns the shared markdown loader, streaming text helpers, and renderer.

import { NEW_CHAT_ACTION_HREF } from "@agent-native/core/client/agent-chat";
import { cn } from "@agent-native/toolkit/utils";
import { IconPlus, IconExternalLink } from "@tabler/icons-react";
import React, { useState, useEffect, useMemo } from "react";
// react-markdown + remark-gfm type imports only — loaded lazily below.
import type { default as ReactMarkdownType } from "react-markdown";
import type { defaultUrlTransform as DefaultUrlTransformType } from "react-markdown";
import type remarkGfmType from "remark-gfm";

import { splitMarkdownBlocks } from "../../../markdown-block-split.js";
import {
  markdownBlockOffsets,
  rehypeStreamingReveal,
  settleStreamingMarkdown,
  STREAMING_REVEAL_BLOCK_CLASS,
} from "../../../streaming-markdown.js";
import { useTableColumnGlide } from "../../../table-column-glide.js";
import {
  useBufferedAgentText,
  useStreamingRevealOrigin,
} from "../../agentkit/react/streaming-text.js";
import { HighlightedCodeBlock as SharedHighlightedCodeBlock } from "../HighlightedCodeBlock.js";
import { IframeEmbed, parseEmbedBody } from "./IframeEmbed.js";
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
  void Promise.all([
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
export const ExternalTextStreamingContext = React.createContext(false);

// `undefined` means "no chat host is providing run state", which is different
// from `false` ("a host is providing it and the run has ended"). Embedded and
// test surfaces render markdown without an AssistantChat above them, and they
// must not be told the run is over.
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

function MarkdownTable(props: React.TableHTMLAttributes<HTMLTableElement>) {
  const { children, ...rest } = props;
  const table = React.useRef<HTMLTableElement>(null);
  // Cells size their columns as they stream; columns glide to new widths.
  useTableColumnGlide(table);
  return (
    <div className="agent-markdown-table-wrap">
      <table ref={table} {...rest}>
        {children}
      </table>
    </div>
  );
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
  table: MarkdownTable,
  pre(props: React.HTMLAttributes<HTMLPreElement>) {
    const { children, ...rest } = props;
    // Rich code renderers drop the <pre>, so its fade moves to a wrapper.
    const revealsAsBlock = Boolean(
      rest.className?.split(" ").includes(STREAMING_REVEAL_BLOCK_CLASS),
    );
    const reveal = (node: React.ReactElement) =>
      revealsAsBlock ? (
        <div className={STREAMING_REVEAL_BLOCK_CLASS}>{node}</div>
      ) : (
        node
      );
    if (React.isValidElement(children)) {
      const childProps = children.props as {
        className?: string;
        children?: React.ReactNode;
      };
      const className = childProps.className || "";
      if (/\blanguage-embed\b/.test(className)) {
        const body = extractCodeText(childProps.children);
        const parsed = parseEmbedBody(body);
        return reveal(
          <IframeEmbed {...(parsed as Parameters<typeof IframeEmbed>[0])} />,
        );
      }
      if (
        new RegExp(`\\blanguage-${LEGACY_CHART_SHORTHAND_LANG}\\b`).test(
          className,
        )
      ) {
        const body = extractCodeText(childProps.children).replace(/\n$/, "");
        const parsed = parseLegacyChartShorthand(body);
        return reveal(
          parsed ? (
            <LegacyChartShorthandChart parsed={parsed} />
          ) : (
            <LegacyChartShorthandFallback text={body} />
          ),
        );
      }
      const lang = className.match(/\blanguage-([\w+-]+)\b/)?.at(1);
      if (lang !== undefined) {
        const code = extractCodeText(childProps.children).replace(/\n$/, "");
        return reveal(<HighlightedCodeBlock code={code} lang={lang} />);
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

export function useSmoothStreamingText(
  targetText: string,
  streaming: boolean,
  resetKey: string,
): string {
  return useBufferedAgentText(targetText, { active: streaming, resetKey });
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
  streaming = false,
  offset = 0,
  animateFrom = null,
}: {
  blockText: string;
  /** The block is the live tail: hold back syntax that has not closed. */
  streaming?: boolean;
  offset?: number | undefined;
  animateFrom?: number | null;
}) {
  const ReactMarkdown = markdownModule?.default;
  const gfm = remarkGfmFn;
  const settled = settleStreamingMarkdown(blockText, streaming);
  const reveals = animateFrom !== null && offset + settled.length > animateFrom;
  const rehypePlugins = useMemo(
    () =>
      reveals
        ? [
            [
              rehypeStreamingReveal,
              { baseOffset: offset, animateFrom },
            ] as const,
          ]
        : undefined,
    [animateFrom, offset, reveals],
  );
  if (!ReactMarkdown || !gfm) return null;
  return (
    <ReactMarkdown
      remarkPlugins={[gfm]}
      rehypePlugins={
        rehypePlugins as React.ComponentProps<
          typeof ReactMarkdownType
        >["rehypePlugins"]
      }
      components={markdownComponents}
      urlTransform={markdownUrlTransform}
    >
      {wrapLegacyChartShorthandLines(settled)}
    </ReactMarkdown>
  );
});

// ─── StreamingText ────────────────────────────────────────────────────────────

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
  /** Allow callers to opt out for static or deliberately chunk-native surfaces. */
  animateStreaming?: boolean;
  onRevealComplete?: () => void;
}) {
  const mdReady = useMarkdownReady();
  const shouldAnimate = streaming && animateStreaming;
  const visibleText = useSmoothStreamingText(text, shouldAnimate, resetKey);
  const animateFrom = useStreamingRevealOrigin(
    visibleText.length,
    shouldAnimate,
  );
  const ReactMarkdown = markdownModule?.default;
  const gfm = remarkGfmFn;
  // Split whether or not the turn is still streaming. Rendering the finished
  // message as one whole-document ReactMarkdown instead swapped the element
  // tree the instant `streaming` went false, so React unmounted every block and
  // rebuilt it: code blocks re-highlighted, heights collapsed for a frame, and
  // the scroll jumped — the "flash at the end" report. The split is faithful to
  // a whole-document parse (see markdown-block-split.ts), so one tree serves
  // both phases and nothing is rebuilt when streaming stops.
  const markdownBlocks = useMemo(
    () => splitMarkdownBlocks(visibleText),
    [visibleText],
  );
  // The tail renders through the same component as completed blocks, so when it
  // is promoted to a completed block React matches the same type at the same
  // key and keeps its DOM instead of remounting that paragraph.
  const renderedBlocks = useMemo(
    () =>
      markdownBlocks.tail
        ? [...markdownBlocks.completedBlocks, markdownBlocks.tail]
        : markdownBlocks.completedBlocks,
    [markdownBlocks],
  );
  const blockOffsets = useMemo(
    () => markdownBlockOffsets(visibleText, renderedBlocks),
    [renderedBlocks, visibleText],
  );
  const holdsBackTail = streaming || visibleText !== text;

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
          <MemoizedMarkdownBlock
            key={index}
            blockText={blockText}
            streaming={holdsBackTail && index === renderedBlocks.length - 1}
            offset={blockOffsets[index]}
            animateFrom={animateFrom}
          />
        ))
      ) : (
        <span style={{ whiteSpace: "pre-wrap" }}>{visibleText}</span>
      )}
    </div>
  );
}

/** @deprecated Use StreamingText for new AgentKit surfaces. */
export const SmoothMarkdownText = StreamingText;

// ─── MarkdownText ──────────────────────────────────────────────────────────────

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
  // The active-turn identity is deliberately retained after a run ends so a
  // late final chunk still animates. Without the `runActive` gate that makes
  // the finished turn's last message permanently "streaming": it never enters
  // the fast settle drain and keeps re-animating on remount.
  const identityStreaming =
    activeMessageStreaming === true && runActive !== false;
  return (
    isLastAssistantMessage &&
    (identityStreaming ||
      (textStreaming &&
        (statusType === "running" || externalStreaming === true)))
  );
}
