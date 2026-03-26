import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let i = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const boldIdx = boldMatch?.index ?? Infinity;

    let starIdx = -1;
    for (let j = 0; j < remaining.length; j++) {
      if (remaining[j] !== "*") continue;
      if (remaining[j + 1] === "*") {
        j++;
        continue;
      }
      const end = remaining.indexOf("*", j + 1);
      if (end === -1) break;
      if (remaining[end + 1] === "*") continue;
      starIdx = j;
      break;
    }

    const useBold = boldMatch && boldIdx !== undefined && boldIdx < starIdx;
    const useItalic = !useBold && starIdx >= 0;

    if (!useBold && !useItalic) {
      nodes.push(<span key={`${keyPrefix}-${i++}`}>{remaining}</span>);
      break;
    }

    if (useBold && boldMatch && boldIdx !== undefined) {
      if (boldIdx > 0) {
        nodes.push(
          <span key={`${keyPrefix}-${i++}`}>{remaining.slice(0, boldIdx)}</span>,
        );
      }
      nodes.push(
        <strong key={`${keyPrefix}-${i++}`} className="font-semibold">
          {boldMatch[1]}
        </strong>,
      );
      remaining = remaining.slice(boldIdx + boldMatch[0].length);
      continue;
    }

    if (useItalic && starIdx >= 0) {
      const end = remaining.indexOf("*", starIdx + 1);
      if (end === -1) break;
      if (starIdx > 0) {
        nodes.push(
          <span key={`${keyPrefix}-${i++}`}>{remaining.slice(0, starIdx)}</span>,
        );
      }
      nodes.push(
        <em key={`${keyPrefix}-${i++}`} className="italic">
          {remaining.slice(starIdx + 1, end)}
        </em>,
      );
      remaining = remaining.slice(end + 1);
    }
  }

  return nodes;
}

function MarkdownLine({ line }: { line: string }) {
  const trimmed = line.trimEnd();
  if (trimmed.startsWith("### ")) {
    return (
      <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground first:mt-0">
        {renderInline(trimmed.slice(4), "h3")}
      </h3>
    );
  }
  if (trimmed.startsWith("## ")) {
    return (
      <h2 className="mt-6 text-xl font-semibold tracking-tight text-foreground first:mt-0">
        {renderInline(trimmed.slice(3), "h2")}
      </h2>
    );
  }
  if (trimmed.startsWith("# ")) {
    return (
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground first:mt-0">
        {renderInline(trimmed.slice(2), "h1")}
      </h1>
    );
  }
  if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
    return (
      <li className="ml-4 list-disc text-sm leading-relaxed text-foreground/90">
        {renderInline(trimmed.slice(2), "li")}
      </li>
    );
  }
  if (trimmed === "") {
    return null;
  }
  return (
    <p className="text-sm leading-relaxed text-foreground/90">{renderInline(trimmed, "p")}</p>
  );
}

export function SimpleMarkdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[] = [];
  let k = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`ul-${k++}`} className="my-2 space-y-1">
        {listItems}
      </ul>,
    );
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();
    const isList = trimmed.startsWith("- ") || trimmed.startsWith("* ");

    if (isList) {
      const idx = listItems.length;
      listItems.push(
        <Fragment key={`li-${idx}`}>
          <MarkdownLine line={line} />
        </Fragment>,
      );
      continue;
    }

    flushList();
    if (trimmed === "") {
      blocks.push(<div key={`sp-${blocks.length}`} className="h-2" />);
    } else {
      const b = blocks.length;
      blocks.push(
        <Fragment key={`ln-${b}`}>
          <MarkdownLine line={line} />
        </Fragment>,
      );
    }
  }
  flushList();

  return <div className={cn("space-y-1", className)}>{blocks}</div>;
}
