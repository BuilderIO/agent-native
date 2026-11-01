import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEffect, useState, type ReactNode } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

type NoticeBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string };

type NoticesState =
  | { status: "loading" }
  | { status: "loaded"; blocks: NoticeBlock[] }
  | { status: "failed"; error: string };

/**
 * Parses the subset of Markdown `THIRD_PARTY_NOTICES.md` uses: headings,
 * paragraphs with links, and fenced blocks holding license text verbatim.
 */
export function parseNotices(markdown: string): NoticeBlock[] {
  const blocks: NoticeBlock[] = [];
  let paragraph: string[] = [];
  let code: string[] | null = null;
  const endParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    }
    paragraph = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (code) {
      if (line.startsWith("```")) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    const heading = /^#{1,6}\s+/.exec(line)?.[0];
    if (line.startsWith("```")) {
      endParagraph();
      code = [];
    } else if (heading) {
      endParagraph();
      blocks.push({
        kind: "heading",
        level: heading.trim().length,
        text: line.slice(heading.length).trim(),
      });
    } else if (line.trim()) {
      paragraph.push(line.trim());
    } else {
      endParagraph();
    }
  }
  endParagraph();
  // An unclosed fence still holds license text, so keep it rather than drop it.
  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  return blocks;
}

function openLink(href: string) {
  openExternal(href).catch((err) => {
    console.error("[settings] could not open an acknowledgements link:", err);
  });
}

function withLinks(text: string): ReactNode[] {
  // Splitting on a capturing pattern leaves each link at an odd index.
  return text.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/).map((part, index) => {
    if (index % 2 === 0) return part;
    const middle = part.indexOf("](");
    const href = part.slice(middle + 2, -1);
    return (
      <a
        key={index}
        href={href}
        className="text-primary underline underline-offset-2"
        onClick={(event) => {
          // The webview would otherwise navigate away from the app.
          event.preventDefault();
          openLink(href);
        }}
      >
        {part.slice(1, middle)}
      </a>
    );
  });
}

function NoticeBlockView({ block }: { block: NoticeBlock }) {
  if (block.kind === "code") {
    return (
      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">
        {block.text}
      </pre>
    );
  }
  if (block.kind === "heading") {
    // The dialog title stands in for the document's own title.
    if (block.level === 1) return null;
    return (
      <h3 className="pt-2 text-sm font-semibold text-foreground">
        {block.text}
      </h3>
    );
  }
  return <p className="text-sm leading-relaxed">{withLinks(block.text)}</p>;
}

export function ThirdPartyNotices({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<NoticesState>({ status: "loading" });

  useEffect(() => {
    if (!open) return;
    let current = true;
    setState({ status: "loading" });
    invoke<string>("read_third_party_notices").then(
      (markdown) => {
        if (current)
          setState({ status: "loaded", blocks: parseNotices(markdown) });
      },
      (err) => {
        console.error("[settings] could not read acknowledgements:", err);
        if (current) setState({ status: "failed", error: String(err) });
      },
    );
    return () => {
      current = false;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[calc(100vh-2rem)] flex-col gap-3 p-0"
      >
        <DialogTitle className="px-5 pt-5">Acknowledgements</DialogTitle>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5 text-muted-foreground">
          {state.status === "loading" ? (
            <>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-40 w-full" />
            </>
          ) : state.status === "failed" ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : (
            state.blocks.map((block, index) => (
              <NoticeBlockView key={index} block={block} />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
