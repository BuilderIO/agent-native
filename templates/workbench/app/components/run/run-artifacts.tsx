import { useMemo } from "react";
import {
  IconAlertTriangle,
  IconFileText,
  IconPhoto,
} from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import type { TranscriptEvent } from "./run-transcript";

interface RunArtifactsProps {
  /** Same events array passed to the transcript. */
  events: TranscriptEvent[];
}

interface Artifact {
  key: string;
  kind: "image" | "log" | "file";
  label: string;
  /** When set, the artifact is openable inline / in a new tab. */
  href?: string;
}

/**
 * Right-rail list of artifacts a run produced.
 *
 * v1.0 only surfaces a best-effort list scraped from `tool_done` outputs —
 * the framework's run-store doesn't have a dedicated artifacts column yet.
 * When the agent emits a tool result that looks like a path to a `.png`,
 * `.log`, or `.txt` file, we list it here.
 */
export function RunArtifacts({ events }: RunArtifactsProps) {
  const artifacts = useMemo(() => collectArtifacts(events), [events]);

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
          <span className="font-semibold">Artifacts</span>
          <span>{artifacts.length}</span>
        </div>
        {artifacts.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No artifacts produced.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {artifacts.map((art) => (
              <li key={art.key}>
                <ArtifactRow artifact={art} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ArtifactRow({ artifact }: { artifact: Artifact }) {
  const Icon =
    artifact.kind === "image"
      ? IconPhoto
      : artifact.kind === "log"
        ? IconAlertTriangle
        : IconFileText;
  const content = (
    <span className="flex items-center gap-2 truncate">
      <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate font-mono text-xs text-foreground">
        {artifact.label}
      </span>
    </span>
  );
  if (artifact.href) {
    return (
      <a
        href={artifact.href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40"
      >
        {content}
      </a>
    );
  }
  return (
    <div
      className="flex items-center gap-2 rounded-md px-2 py-1.5"
      title={artifact.label}
    >
      {content}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heuristic artifact extraction
// ---------------------------------------------------------------------------

const IMAGE_RE = /([\w./-]+\.(?:png|jpe?g|gif|svg|webp))/gi;
const LOG_RE = /([\w./-]+\.(?:log))/gi;
const TEXT_RE = /([\w./-]+\.(?:txt|md))/gi;
const URL_RE =
  /(https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|svg|webp|log|txt|md))/gi;

function collectArtifacts(events: TranscriptEvent[]): Artifact[] {
  const seen = new Map<string, Artifact>();

  const consume = (text: string, runSeq: number) => {
    // URLs first — they're more specific than bare paths.
    let m: RegExpExecArray | null;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text)) !== null) {
      const href = m[1];
      addArtifact(seen, runSeq, href, href, classify(href));
    }
    IMAGE_RE.lastIndex = 0;
    while ((m = IMAGE_RE.exec(text)) !== null) {
      addArtifact(seen, runSeq, m[1], m[1], "image");
    }
    LOG_RE.lastIndex = 0;
    while ((m = LOG_RE.exec(text)) !== null) {
      addArtifact(seen, runSeq, m[1], m[1], "log");
    }
    TEXT_RE.lastIndex = 0;
    while ((m = TEXT_RE.exec(text)) !== null) {
      addArtifact(seen, runSeq, m[1], m[1], "file");
    }
  };

  for (const ev of events) {
    const e = ev.event;
    const type = e.type as string | undefined;
    if (type === "tool_done" && typeof e.result === "string") {
      consume(e.result, ev.seq);
    } else if (type === "text" && typeof e.text === "string") {
      consume(e.text, ev.seq);
    }
  }

  return Array.from(seen.values()).slice(0, 20);
}

function addArtifact(
  acc: Map<string, Artifact>,
  seq: number,
  label: string,
  href: string,
  kind: Artifact["kind"],
): void {
  if (acc.has(label)) return;
  const isExternal = href.startsWith("http://") || href.startsWith("https://");
  acc.set(label, {
    key: `${seq}-${label}`,
    kind,
    label,
    href: isExternal ? href : undefined,
  });
}

function classify(href: string): Artifact["kind"] {
  if (/\.(png|jpe?g|gif|svg|webp)$/i.test(href)) return "image";
  if (/\.(log)$/i.test(href)) return "log";
  return "file";
}
