/**
 * A DOM-only Mermaid renderer shared by the toolkit's block library and by
 * app-specific code surfaces (for example a TipTap code block whose language
 * registry marks Mermaid as `customRender`). It has no React dependency, so an
 * imperative NodeView can call it directly.
 *
 * The renderer is intentionally lazy: `mermaid` is imported on first use so a
 * document without a diagram never pays for the bundle.
 */

interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
}

let mermaidPromise: Promise<MermaidApi> | null = null;

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const namespace = mod as { default?: unknown };
      return (namespace.default ?? mod) as MermaidApi;
    });
  }
  return mermaidPromise;
}

export function mermaidErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to render diagram";
}

/**
 * Strip scripts and inline event handlers out of rendered SVG. Mermaid is asked
 * for `securityLevel: "strict"`, and this is the second line of defense before
 * the markup reaches `innerHTML`.
 */
export function sanitizeMermaidSvgMarkup(svg: string): string {
  if (typeof DOMParser === "undefined") return svg;
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  // A foreignObject is how mermaid renders a node's label when the diagram look is
  // handDrawn - deleting it wholesale left every node an empty box. Keep the
  // element and take the dangerous parts out of it instead: scripts, embedded documents
  // and form controls go, and the attribute pass below removes event handlers and
  // javascript: URLs everywhere, inside the foreignObject included.
  doc
    .querySelectorAll(
      "script, foreignObject iframe, foreignObject object, foreignObject embed, " +
        "foreignObject link, foreignObject meta, foreignObject base, foreignObject form, " +
        "foreignObject math, foreignObject portal, foreignObject template",
    )
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

export interface RenderMermaidOptions {
  /** A unique, DOM-id-safe seed; the theme is appended so a theme flip re-renders. */
  id: string;
  dark?: boolean;
}

/**
 * Render one Mermaid source string to sanitized SVG markup. Throws on a parse or
 * render error; callers decide how to surface the failure (the code surface
 * keeps the source visible, the block library shows the message).
 */
export async function renderMermaidToSvg(
  source: string,
  options: RenderMermaidOptions,
): Promise<string> {
  const mermaid = await loadMermaid();
  const dark = options.dark ?? false;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    look: "handDrawn",
    theme: dark ? "dark" : "neutral",
    // Labels as SVG text, not HTML in a foreignObject. `sanitizeMermaidSvgMarkup` strips
    // every foreignObject (it can carry script), so with mermaid's HTML default each node's
    // label group came back empty and a reader saw hand-drawn boxes with no words in them -
    // measured on the served build: g.label present and empty, 0 <text>, 0 foreignObject,
    // shapes intact.
    flowchart: { htmlLabels: false },
  });
  const { svg } = await mermaid.render(options.id, source);
  return sanitizeMermaidSvgMarkup(svg);
}
