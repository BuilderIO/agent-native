import { useEffect, useId, useMemo, useState } from "react";
import { IconArrowsMaximize } from "@tabler/icons-react";
import type { BlockEditProps, BlockReadProps } from "../types.js";
import type { MermaidData } from "./mermaid.config.js";
import { DevInput, DevLabel } from "./dev-doc-ui.js";
import { DiagramLightbox } from "./diagram.js";

/**
 * Read + Edit renderers for a `mermaid` block — a Mermaid diagram definition
 * (flowchart, sequence, etc.) edited as raw text and rendered as an
 * Excalidraw-style SVG so it matches the plan's hand-drawn / sketchy house
 * style.
 * Lives in core so any app can register the dev-doc block; it stays app-agnostic
 * (no shadcn / next-themes import).
 *
 * The Mermaid and Excalidraw runtimes are browser-only,
 * so the Read renderer SSR-guards: it renders a lightweight placeholder until a
 * `useEffect` confirms it is mounted, then dynamically imports
 * `@excalidraw/mermaid-to-excalidraw` + `@excalidraw/excalidraw` and injects
 * the exported SVG. If Excalidraw conversion fails, it falls back to Mermaid's
 * hand-drawn renderer. Parse errors never throw; they show the raw source and
 * the error message.
 *
 * Dark mode: the plan editor toggles a `.dark` class on <html>. The Read renderer
 * reads `document.documentElement.classList.contains("dark")` (re-checking on a
 * `MutationObserver` of the html class) and re-renders the diagram with matching
 * light/dark export settings.
 */

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

/** Read the live dark-mode flag from the document root (next-themes-free). */
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

/**
 * Inject a rendered Mermaid/Excalidraw SVG string. Shared by the inline render
 * and the expand lightbox so the enlarged view shows the exact same SVG; the
 * lightbox passes `enlarged` so the SVG stretches to fill the wider modal
 * (`max-w-5xl`) instead of staying at its intrinsic inline size.
 */
function MermaidSvg({ svg, enlarged }: { svg: string; enlarged?: boolean }) {
  return (
    <div
      className={
        enlarged
          ? "flex justify-center overflow-auto [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-full"
          : "mt-2 flex justify-center overflow-auto [&_svg]:h-auto [&_svg]:max-w-full"
      }
      // Excalidraw and Mermaid output are sanitized before injection.
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
  // Only render the diagram after mount: `mermaid` is client-only and SSR has no
  // DOM for it to measure against.
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<MermaidRenderState>({});
  const [expanded, setExpanded] = useState(false);

  // A DOM-id-safe, stable-per-block render id. Mermaid requires a valid CSS id.
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
    (async () => {
      try {
        const svg = await renderExcalidrawSvg(trimmed, isDark);
        if (!cancelled) setState({ svg });
      } catch (excalidrawError) {
        try {
          // Fallback keeps diagrams usable if a Mermaid feature is not supported
          // by the Excalidraw converter in a given host app.
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
        Loading diagram…
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
          Could not render diagram: {state.error}
        </p>
      </div>
    );
  }

  if (!state.svg) {
    return (
      <div className="mt-2 flex min-h-24 items-center justify-center rounded-lg border border-plan-line bg-plan-code text-sm text-plan-muted">
        Add a diagram definition to render it.
      </div>
    );
  }

  // Hover-revealed top-right expand button + shared lightbox, matching the
  // DiagramBlock affordance exactly (same icon, reveal-on-hover/focus, Escape +
  // backdrop close via the reused `DiagramLightbox`). The enlarged view re-shows
  // the same rendered SVG scaled to fit the wider modal.
  const svg = state.svg;
  return (
    <div className="group/mermaid relative">
      <MermaidSvg svg={svg} />
      <button
        type="button"
        data-plan-interactive
        onClick={() => setExpanded(true)}
        aria-label="Expand diagram"
        title="Expand diagram"
        className="an-diagram-expand-trigger absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-md border border-border/60 bg-background/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-[color,opacity] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/mermaid:opacity-100"
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

/**
 * Read-only renderer for a `mermaid` block. Wraps the diagram in the standard
 * titled `plan-block` section + an optional muted caption, matching the plan
 * house style.
 */
export function MermaidRead({
  data,
  blockId,
  title,
  summary,
}: BlockReadProps<MermaidData>) {
  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <MermaidDiagram source={data.source} idSeed={blockId} />
      {data.caption && (
        <p className="mt-3 text-sm text-plan-muted">{data.caption}</p>
      )}
      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}

/**
 * Edit renderer (panel surface) for a `mermaid` block: a monospace textarea for
 * the diagram source plus an optional caption input. Both commit immediately via
 * `onChange`. `editSurface: "panel"` means the registry renders the `Read` view
 * with a corner edit button that opens this form in the plan's shared popover, so
 * this renders only the form (the popover supplies the chrome and title).
 */
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
