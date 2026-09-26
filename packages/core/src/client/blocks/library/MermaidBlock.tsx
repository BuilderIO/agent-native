import { IconArrowsMaximize } from "@tabler/icons-react";
import { useEffect, useId, useMemo, useState } from "react";

import { ltrCodeBlockProps } from "../code-block-direction.js";
import type { BlockEditProps, BlockReadProps } from "../types.js";
import { useBlockCopy } from "./block-copy.js";
import { DevInput, DevLabel } from "./dev-doc-ui.js";
import { DiagramLightbox } from "./diagram.js";
import type { MermaidData } from "./mermaid.config.js";

interface MermaidRenderState {
  svg?: string;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to render diagram";
}

function sanitizeSvgMarkup(svg: string): string {
  if (typeof DOMParser === "undefined") return svg;
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  doc
    .querySelectorAll("script, foreignObject")
    .forEach((node) => node.remove());
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        ((name === "href" || name.endsWith(":href")) &&
          value.startsWith("javascript:"))
      ) {
        element.removeAttribute(attr.name);
      }
    }
  }
  return doc.documentElement.outerHTML;
}

async function renderExcalidrawSvg(
  source: string,
  isDark: boolean,
): Promise<string> {
  const [{ parseMermaidToExcalidraw }, excalidraw] = await Promise.all([
    import("@excalidraw/mermaid-to-excalidraw") as Promise<{
      parseMermaidToExcalidraw: (source: string) => Promise<{
        elements: unknown[];
        files?: Record<string, unknown>;
      }>;
    }>,
    import("@excalidraw/excalidraw") as Promise<{
      convertToExcalidrawElements: (elements: unknown[]) => unknown[];
      exportToSvg: (options: {
        elements: unknown[];
        appState: {
          theme: "dark" | "light";
          viewBackgroundColor: string;
          exportWithDarkMode: boolean;
        };
        files: Record<string, unknown>;
      }) => Promise<{ outerHTML: string }>;
    }>,
  ]);
  const { elements, files } = await parseMermaidToExcalidraw(source);
  const excalidrawElements = excalidraw.convertToExcalidrawElements(elements);
  const svg = await excalidraw.exportToSvg({
    elements: excalidrawElements,
    appState: {
      theme: isDark ? "dark" : "light",
      viewBackgroundColor: "transparent",
      exportWithDarkMode: isDark,
    },
    files: files ?? {},
  });
  return sanitizeSvgMarkup(svg.outerHTML);
}

async function renderMermaidSvg(
  source: string,
  id: string,
  isDark: boolean,
): Promise<string> {
  const mermaid = (
    (await import("mermaid")) as {
      default: {
        initialize: (config: Record<string, unknown>) => void;
        render: (id: string, source: string) => Promise<{ svg: string }>;
      };
    }
  ).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    look: "handDrawn",
    theme: isDark ? "dark" : "neutral",
  });
  const { svg } = await mermaid.render(id, source);
  return sanitizeSvgMarkup(svg);
}

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const read = () => setIsDark(root.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function MermaidSvg({ svg, enlarged }: { svg: string; enlarged?: boolean }) {
  return (
    <div
      className={
        enlarged
          ? "flex justify-center overflow-auto [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-full"
          : "mt-2 flex justify-center overflow-auto [&_svg]:h-auto [&_svg]:max-w-full"
      }
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function MermaidDiagram({
  source,
  idSeed,
}: {
  source: string;
  idSeed: string;
}) {
  const isDark = useIsDark();
  const copy = useBlockCopy();
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<MermaidRenderState>({});
  const [expanded, setExpanded] = useState(false);

  const renderId = useMemo(
    () => `mermaid-${idSeed.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    [idSeed],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    const trimmed = source.trim();
    if (!trimmed) {
      setState({});
      return;
    }
    void (async () => {
      try {
        const svg = await renderExcalidrawSvg(trimmed, isDark);
        if (!cancelled) setState({ svg });
      } catch (excalidrawError) {
        try {
          const svg = await renderMermaidSvg(
            trimmed,
            `${renderId}-${isDark ? "d" : "l"}`,
            isDark,
          );
          if (!cancelled) setState({ svg });
        } catch (mermaidError) {
          const excalidrawMessage = errorMessage(excalidrawError);
          const mermaidMessage = errorMessage(mermaidError);
          if (!cancelled) {
            setState({
              error:
                excalidrawMessage === mermaidMessage
                  ? mermaidMessage
                  : `Excalidraw: ${excalidrawMessage}; Mermaid fallback: ${mermaidMessage}`,
            });
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-render when the source OR the resolved theme changes so toggling
    // dark/light updates the diagram live.
  }, [mounted, source, isDark, renderId]);

  if (!mounted) {
    return (
      <div className="mt-2 flex min-h-24 items-center justify-center rounded-lg border border-plan-line bg-plan-code text-sm text-plan-muted">
        {copy.loadingDiagram}
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="mt-2 space-y-2">
        <pre className="overflow-auto rounded-lg border border-plan-line bg-plan-code px-3 py-2 font-mono [font-size:var(--plan-code-size)] text-plan-code-text">
          {source}
        </pre>
        <p className="text-sm text-plan-muted">
          {copy.couldNotRenderDiagram}: {state.error}
        </p>
      </div>
    );
  }

  if (!state.svg) {
    return (
      <div className="mt-2 flex min-h-24 items-center justify-center rounded-lg border border-plan-line bg-plan-code text-sm text-plan-muted">
        {copy.addDiagramDefinition}
      </div>
    );
  }

  const svg = state.svg;
  return (
    <div className="group/mermaid relative">
      <MermaidSvg svg={svg} />
      <button
        type="button"
        data-plan-interactive
        onClick={() => setExpanded(true)}
        aria-label={copy.expandDiagram}
        title={copy.expandDiagram}
        className="an-diagram-expand-trigger absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground opacity-0 shadow-sm transition-[color,opacity] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/mermaid:opacity-100"
      >
        <IconArrowsMaximize className="size-4" />
      </button>
      {expanded ? (
        <DiagramLightbox onClose={() => setExpanded(false)}>
          <MermaidSvg svg={svg} enlarged />
        </DiagramLightbox>
      ) : null}
    </div>
  );
}

export function MermaidRead({
  data,
  blockId,
  title,
  summary,
}: BlockReadProps<MermaidData>) {
  return (
    <section
      {...ltrCodeBlockProps}
      className="plan-block"
      data-block-id={blockId}
    >
      {title && <div className="plan-block-label">{title}</div>}
      <MermaidDiagram source={data.source} idSeed={blockId} />
      {data.caption && (
        <p className="mt-3 text-sm text-plan-muted">{data.caption}</p>
      )}
      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}

export function MermaidEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<MermaidData>) {
  const sourceId = useId();
  const captionId = useId();

  return (
    <div className="grid gap-3" data-plan-interactive>
      <div className="grid gap-1.5">
        <DevLabel htmlFor={sourceId}>Diagram source</DevLabel>
        <textarea
          id={sourceId}
          value={data.source}
          readOnly={!editable}
          spellCheck={false}
          onChange={(event) =>
            onChange({ ...data, source: event.target.value })
          }
          className="flex min-h-56 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={"flowchart TD\n  A[Start] --> B{Decision}"}
        />
        <p className="text-xs text-muted-foreground">
          Mermaid syntax — flowcharts, sequence diagrams, and more.
        </p>
      </div>
      <div className="grid gap-1.5">
        <DevLabel htmlFor={captionId}>Caption</DevLabel>
        <DevInput
          id={captionId}
          value={data.caption ?? ""}
          readOnly={!editable}
          onChange={(event) =>
            onChange({
              ...data,
              caption: event.target.value || undefined,
            })
          }
          placeholder="Optional caption"
        />
      </div>
    </div>
  );
}
