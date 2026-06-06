import { useEffect, useId, useMemo, useState } from "react";
import type { BlockEditProps, BlockReadProps } from "../types.js";
import type { MermaidData } from "./mermaid.config.js";
import { DevInput, DevLabel } from "./dev-doc-ui.js";

/**
 * Read + Edit renderers for a `mermaid` block — a Mermaid diagram definition
 * (flowchart, sequence, etc.) edited as raw text and rendered with Mermaid's
 * `handDrawn` look so it matches the plan's hand-drawn / sketchy house style.
 * Lives in core so any app can register the dev-doc block; it stays app-agnostic
 * (no shadcn / next-themes import).
 *
 * `mermaid` is a browser-only runtime (it touches `document`/DOM measurement),
 * so the Read renderer SSR-guards: it renders a lightweight placeholder until a
 * `useEffect` confirms it is mounted, then dynamically imports `mermaid` and
 * injects the rendered SVG. Parse errors never throw — they fall back to the raw
 * source in a styled monospace block plus the error message. (The dynamic import
 * uses a runtime specifier so this module never forces `mermaid` into the core
 * package's own dependency graph — the host app provides it.)
 *
 * Dark mode: the plan editor toggles a `.dark` class on <html>. The Read renderer
 * reads `document.documentElement.classList.contains("dark")` (re-checking on a
 * `MutationObserver` of the html class) and re-renders the diagram with Mermaid's
 * `dark` theme (vs `neutral` in light) — the resolved theme is in the render
 * effect's deps so toggling dark/light updates the SVG live.
 */

/** Module specifier kept in a variable so the bundler/tsc treats it as a runtime
 * import (core does not depend on `mermaid`; the host app provides it). */
const MERMAID_MODULE = "mermaid";

interface MermaidRenderState {
  svg?: string;
  error?: string;
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
        const mermaid = ((await import(MERMAID_MODULE)) as { default: any })
          .default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          look: "handDrawn",
          theme: isDark ? "dark" : "neutral",
        });
        // Unique id per render pass so re-renders (theme/source change) never
        // collide with a stale, still-mounted SVG node id.
        const { svg } = await mermaid.render(
          `${renderId}-${isDark ? "d" : "l"}`,
          trimmed,
        );
        if (!cancelled) setState({ svg });
      } catch (error) {
        if (!cancelled) {
          setState({
            error:
              error instanceof Error
                ? error.message
                : "Failed to render diagram",
          });
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
        <pre className="overflow-auto rounded-lg border border-plan-line bg-plan-code px-3 py-2 font-mono text-sm text-plan-code-text">
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

  return (
    <div
      className="mt-2 flex justify-center overflow-auto [&_svg]:max-w-full [&_svg]:h-auto"
      // Mermaid output is already sanitized under `securityLevel: "strict"`.
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
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
