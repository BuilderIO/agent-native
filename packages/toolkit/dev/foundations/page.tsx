import * as React from "react";

import { Badge } from "../../src/ui/base-ui/badge.js";
import { Separator } from "../../src/ui/base-ui/separator.js";
import {
  LiveRoot,
  type Resolved,
  resolvedText,
  type TokenUsage,
} from "./live.js";

export function Page({
  title,
  intro,
  children,
}: {
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <LiveRoot>
      <article className="flex flex-col gap-10 pb-16">
        <header className="flex max-w-[640px] flex-col gap-3">
          <h1 className="text-7 font-semibold text-fg">{title}</h1>
          <p className="text-3 text-fg">{intro}</p>
        </header>
        {children}
      </article>
    </LiveRoot>
  );
}

/** A titled section; its explanation, when it needs one, is the first paragraph of its body. */
export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <Separator />
      <h2 id={id} className="text-5 font-semibold text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Prose({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[640px] text-2 text-fg">{children}</p>;
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="text-1 whitespace-nowrap text-fg"
      style={{ fontFamily: "var(--font-family-mono)" }}
    >
      {children}
    </code>
  );
}

/** A resolved value in mono, muted, with an unset token called out. */
export function Value({ resolved }: { resolved: Resolved | undefined }) {
  const unset = resolved?.status === "unset";
  return (
    <code
      className={`text-1 break-all ${unset ? "text-fg-danger" : "text-fg-muted"}`}
      style={{ fontFamily: "var(--font-family-mono)" }}
    >
      {resolvedText(resolved)}
    </code>
  );
}

/** `--token → value`, the way every step names itself. */
export function TokenValue({
  token,
  resolved,
}: {
  token: string;
  resolved: Resolved | undefined;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <Code>{token}</Code>
      <Value resolved={resolved} />
    </span>
  );
}

export interface Column {
  label: string;
  /** What the header shows, when more than its label. */
  content?: React.ReactNode;
  /** Visually hidden header, for a column of samples. */
  hidden?: boolean;
  className?: string;
}

export function Table({
  caption,
  columns,
  children,
}: {
  caption: string;
  columns: readonly Column[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-2">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={`border-b border-line py-2 pr-4 text-1 font-medium text-fg-muted ${column.className ?? ""}`}
              >
                <span className={column.hidden ? "sr-only" : undefined}>
                  {column.content ?? column.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return <tr className="border-b border-line-subtle">{children}</tr>;
}

export function Cell({
  children,
  header = false,
  className = "",
}: {
  children?: React.ReactNode;
  header?: boolean;
  className?: string;
}) {
  const classes = `py-2 pr-4 align-middle ${className}`;
  return header ? (
    <th scope="row" className={`${classes} font-normal`}>
      {children}
    </th>
  ) : (
    <td className={classes}>{children}</td>
  );
}

/** A color sample; its name is the text beside it, so the box itself is decorative. */
export function Swatch({
  color,
  size = "md",
}: {
  color: string;
  size?: "sm" | "md" | "lg";
}) {
  const box = { sm: "size-5", md: "size-8", lg: "h-12 w-full" }[size];
  return (
    <span
      aria-hidden="true"
      className={`block shrink-0 rounded-control ${box}`}
      style={{
        background: color,
        boxShadow: "inset 0 0 0 1px var(--gray-a5)",
      }}
    />
  );
}

/** The parts whose CSS reads a token, from the loaded stylesheets. */
export function UsedBy({
  usage,
  token,
}: {
  usage: TokenUsage | null;
  token: string;
}) {
  if (usage === null) return null;
  const parts = [...(usage.parts.get(token) ?? [])].sort();
  if (parts.length === 0) {
    return <span className="text-1 text-fg-subtle">No part reads it</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {parts.map((part) => (
        <Badge key={part} color="gray" variant="soft">
          {part}
        </Badge>
      ))}
    </span>
  );
}

/** Says when the usage scan could not read every stylesheet, so a gap is visible. */
export function UsageNote({ usage }: { usage: TokenUsage | null }) {
  if (usage === null || usage.unreadableSheets === 0) return null;
  return (
    <p className="text-1 text-fg-muted">
      {usage.unreadableSheets} stylesheets from another origin could not be
      scanned, so parts may be missing from Used by.
    </p>
  );
}
