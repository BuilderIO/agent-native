import { useT } from "@agent-native/core/client/i18n";
import { IconChevronRight } from "@tabler/icons-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "../../utils.js";
import { isExtensionApiPath } from "../extensions/extension-links.js";
import { InlineMarkdown } from "../review/InlineMarkdown.js";

const BLOCKED_API_PATH_PREFIXES = [
  "/_agent-native/auth",
  "/_agent-native/actions",
];

function isBlockedApiPath(pathname: string): boolean {
  let candidate = normalizePathSeparators(pathname);
  for (let decodePass = 0; decodePass < 3; decodePass += 1) {
    if (matchesBlockedApiPathPrefix(candidate)) return true;
    const decoded = candidate
      .split("/")
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join("/");
    const normalized = normalizePathSeparators(decoded);
    if (normalized === candidate) return false;
    candidate = normalized;
  }
  return matchesBlockedApiPathPrefix(candidate);
}

function normalizePathSeparators(pathname: string): string {
  return pathname.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function matchesBlockedApiPathPrefix(pathname: string): boolean {
  return BLOCKED_API_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function safeDashboardLinkHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href) return null;
  if (href.startsWith("//")) return null;

  const relativeBase = new URL("https://agent-native.local");
  const isRelative = href.startsWith("/");
  const base = isRelative ? relativeBase : undefined;
  if (!URL.canParse(href, base)) return null;

  const parsed = new URL(href, base);
  if (isRelative && parsed.origin !== relativeBase.origin) return null;
  const sameOrigin =
    isRelative ||
    (typeof window !== "undefined" && parsed.origin === window.location.origin);
  if (
    sameOrigin &&
    (isExtensionApiPath(parsed.pathname) || isBlockedApiPath(parsed.pathname))
  ) {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? href
    : null;
}

export function renderDashboardMarkdownLink(
  href: string,
  children: ReactNode,
  className: string,
): ReactNode {
  const safeHref = safeDashboardLinkHref(href);
  if (!safeHref) return children;
  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

export function DashboardPanelDescription({
  description,
  className,
  collapsible = false,
}: {
  description: unknown;
  className: string;
  collapsible?: boolean;
}) {
  if (typeof description !== "string" || !description) return null;
  if (!collapsible) {
    return (
      <InlineMarkdown
        inline
        content={description}
        className={className}
        linkClassName="text-current underline underline-offset-2 hover:opacity-80"
        renderLink={renderDashboardMarkdownLink}
      />
    );
  }
  return (
    <CollapsiblePanelDescription content={description} className={className} />
  );
}

function CollapsiblePanelDescription({
  content,
  className,
}: {
  content: string;
  className: string;
}) {
  const t = useT();
  const contentId = useId();
  const textRef = useRef<HTMLSpanElement | null>(null);
  const hasLineBreak = /[\r\n]/.test(content);
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const [overflowState, setOverflowState] = useState<{
    content: string;
    overflows: boolean;
  }>(() => ({
    content,
    overflows: hasLineBreak || content.trim().length > 80,
  }));

  const isExpanded = expandedFor === content;
  const canExpand =
    overflowState.content === content
      ? overflowState.overflows
      : hasLineBreak || content.trim().length > 80;
  const isInteractive = isExpanded || canExpand;

  useLayoutEffect(() => {
    if (isExpanded) return;
    const element = textRef.current;
    if (!element) return;

    const measure = () => {
      if (element.clientWidth <= 0) return;
      const nextOverflows =
        hasLineBreak ||
        element.scrollWidth > element.clientWidth + 1 ||
        element.scrollHeight > element.clientHeight + 1;
      setOverflowState((prev) =>
        prev.content === content && prev.overflows === nextOverflows
          ? prev
          : { content, overflows: nextOverflows },
      );
    };

    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [content, hasLineBreak, isExpanded]);

  const toggleExpanded = () => {
    setExpandedFor((current) => (current === content ? null : content));
  };

  return (
    <div
      data-panel-description=""
      data-expanded={isExpanded ? "true" : "false"}
      data-no-panel-chat-select={isInteractive ? "" : undefined}
      onClick={
        isInteractive
          ? (event) => {
              const target = event.target;
              if (target instanceof Element && target.closest("a, button")) {
                return;
              }
              const selection =
                typeof window !== "undefined" ? window.getSelection() : null;
              if (selection && selection.toString().length > 0) {
                return;
              }
              toggleExpanded();
            }
          : undefined
      }
      className={cn(
        "group/desc flex min-w-0 items-start gap-1",
        isInteractive && "cursor-pointer",
        className,
      )}
    >
      {isInteractive ? (
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={contentId}
          aria-label={
            isExpanded
              ? t("sqlDashboard.collapseDescription")
              : t("sqlDashboard.expandDescription")
          }
          onClick={toggleExpanded}
          className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconChevronRight
            className={cn(
              "size-3.5 transition-transform duration-150 motion-reduce:transition-none rtl:rotate-180",
              isExpanded && "rotate-90 rtl:rotate-90",
            )}
          />
        </button>
      ) : null}
      <span
        id={contentId}
        ref={textRef}
        className={cn(
          "min-w-0 flex-1",
          !isExpanded && "truncate",
          isInteractive &&
            !isExpanded &&
            "transition-colors group-hover/desc:text-foreground",
        )}
      >
        <InlineMarkdown
          inline
          breaksAsSpaces={!isExpanded}
          content={content}
          className={cn(!isExpanded && "whitespace-nowrap")}
          linkClassName="text-current underline underline-offset-2 hover:opacity-80"
          renderLink={renderDashboardMarkdownLink}
        />
      </span>
    </div>
  );
}
