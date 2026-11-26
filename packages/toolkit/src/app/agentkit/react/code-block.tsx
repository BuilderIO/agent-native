import { IconCheck, IconCopy } from "@tabler/icons-react";
import {
  Children,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ThemedToken } from "shiki/core";

import { writeClipboardText } from "../../../agentkit.js";
import { IconButton } from "../../../design-system/index.js";
import {
  CODE_THEMES,
  loadCodeHighlighter,
  resolveCodeLanguage,
} from "../../code-highlighter.js";
import { useAgentKitLabels } from "./context.js";

export type CodeBlockLineVariant =
  | "default"
  | "added"
  | "removed"
  | "highlighted";

function classes(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export function CodeBlock({
  className,
  size = "default",
  variant = "default",
  ...props
}: ComponentProps<"div"> & {
  size?: "default" | "sm";
  variant?: "default" | "destructive";
}) {
  return (
    <div
      data-slot="code-block"
      data-size={size}
      data-variant={variant}
      className={classes("agentkit-code-block", className)}
      {...props}
    />
  );
}

export function CodeBlockHeader({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-header"
      className={classes("agentkit-code-block-header", className)}
      {...props}
    />
  );
}

/** A filename, language, or command. Truncates. */
export function CodeBlockTitle({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      data-slot="code-block-title"
      className={classes("agentkit-code-block-title", className)}
      {...props}
    />
  );
}

/** Outside a header, floats over the content and shows on hover or focus. */
export function CodeBlockActions({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-actions"
      className={classes("agentkit-code-block-actions", className)}
      {...props}
    />
  );
}

export function CodeBlockCopyButton({
  value,
  label,
  copiedLabel,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
}) {
  const labels = useAgentKitLabels();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    if (!(await writeClipboardText(value))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2_000);
  };
  const copiedText = copiedLabel ?? labels.codeCopied;
  return (
    <>
      <IconButton
        label={copied ? copiedText : (label ?? labels.copyCode)}
        icon={
          copied ? (
            <IconCheck aria-hidden="true" size={16} />
          ) : (
            <IconCopy aria-hidden="true" size={16} />
          )
        }
        size="compact"
        className="size-6 rounded-[var(--agentkit-code-action-radius,var(--agentkit-radius-xs))]"
        onPress={() => void copy()}
      />
      {/* A changed name on the focused button is not reliably read. */}
      <span className="agentkit-visually-hidden" aria-live="polite">
        {copied ? copiedText : ""}
      </span>
    </>
  );
}

/** Diff variants carry a +/− marker, not color alone. */
export function CodeBlockLine({
  className,
  variant = "default",
  children,
  ...props
}: ComponentProps<"span"> & { variant?: CodeBlockLineVariant }) {
  const labels = useAgentKitLabels();
  // Screen readers hear this word, not the silent CSS +/−; it stays out of selections.
  const change =
    variant === "added"
      ? labels.workStepLineAdded
      : variant === "removed"
        ? labels.workStepLineRemoved
        : undefined;
  return (
    <span
      data-slot="code-block-line"
      data-variant={variant === "default" ? undefined : variant}
      className={classes("agentkit-code-line", className)}
      {...props}
    >
      {change ? (
        <span className="agentkit-visually-hidden agentkit-code-line-change">
          {`${change} `}
        </span>
      ) : null}
      {children}
    </span>
  );
}

/** Line numbers stay out of copied text and the accessibility tree. */
export function CodeBlockContent({
  children,
  language,
  wrap = false,
  lineNumbers = false,
  startLine = 1,
  tabIndex = 0,
  className,
  style,
  ...props
}: Omit<ComponentProps<"pre">, "children"> & {
  children: string | ReactNode;
  language?: string | undefined;
  wrap?: boolean;
  lineNumbers?: boolean;
  startLine?: number;
}) {
  const source = typeof children === "string" ? children : "";
  const highlighted = useHighlightedCode(
    source,
    typeof children === "string" ? language : undefined,
  );
  const lines =
    typeof children === "string"
      ? highlighted.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))
      : Children.toArray(children);
  return (
    <pre
      data-slot="code-block-content"
      data-wrap={wrap ? "true" : undefined}
      data-line-numbers={lineNumbers ? "true" : undefined}
      dir="ltr"
      tabIndex={tabIndex}
      className={classes("agentkit-code-block-content", className)}
      style={
        lineNumbers && startLine !== 1
          ? ({
              ...style,
              "--agentkit-code-start-line": startLine - 1,
            } as CSSProperties)
          : style
      }
      {...props}
    >
      <code
        className={language ? `language-${language}` : undefined}
        data-language={language}
      >
        {lines.flatMap((line, index) => (index ? ["\n", line] : [line]))}
      </code>
    </pre>
  );
}

export function CodeBlockFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-footer"
      className={classes("agentkit-code-block-footer", className)}
      {...props}
    />
  );
}

function codeLines(code: string): string[] {
  return code.replace(/\n$/, "").split("\n");
}

// An `ansi` pass drops these from token text, so the plain line must too.
const ANSI_SEQUENCE = /\u001b\[[0-9;]*m/g;

function visibleLine(line: string, language: string | undefined): string {
  return language === "ansi" ? line.replace(ANSI_SEQUENCE, "") : line;
}

function tokenText(tokens: ThemedToken[]): string {
  return tokens.map((token) => token.content).join("");
}

interface HighlightPass {
  language: string;
  lines: ThemedToken[][];
}

const HIGHLIGHT_INTERVAL_MS = 80;

/** A line keeps its last tokens until its text changes, so streaming never flashes it plain. */
export function useHighlightedCode(
  code: string,
  language: string | undefined,
): ReactNode[] {
  const [pass, setPass] = useState<HighlightPass | null>(null);
  const lastRun = useRef(0);
  useEffect(() => {
    if (!language) return;
    let cancelled = false;
    const wait = Math.max(
      0,
      HIGHLIGHT_INTERVAL_MS - (Date.now() - lastRun.current),
    );
    const timer = setTimeout(() => {
      lastRun.current = Date.now();
      void loadCodeHighlighter().then(
        (highlighter) => {
          if (cancelled) return;
          const lang = resolveCodeLanguage(highlighter, language);
          if (!lang) return setPass(null);
          const { tokens } = highlighter.codeToTokens(code.replace(/\n$/, ""), {
            lang,
            themes: CODE_THEMES,
            defaultColor: false,
          });
          setPass({ language, lines: tokens });
        },
        // Highlighting is decoration: the plain lines already show the code.
        () => undefined,
      );
    }, wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, language]);
  const usable = pass && pass.language === language ? pass.lines : undefined;
  return codeLines(code).map((source, index) => {
    const line = visibleLine(source, language);
    const tokens = usable?.[index];
    if (!tokens || tokenText(tokens) !== line) return line;
    return tokens.map((token, tokenIndex) => (
      <span
        key={tokenIndex}
        className="agentkit-code-token"
        style={token.htmlStyle as CSSProperties | undefined}
      >
        {token.content}
      </span>
    ));
  });
}
