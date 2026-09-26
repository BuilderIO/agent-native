import DOMPurify from "dompurify";
import { useEffect, useRef, useState } from "react";

type MermaidModule = typeof import("mermaid");

let mermaidLoader: Promise<MermaidModule["default"]> | null = null;
function loadMermaid(): Promise<MermaidModule["default"]> {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid")
      .then((mod) => {
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
          themeVariables: {
            darkMode: true,
            background: "transparent",
            primaryColor: "#1a1a2e",
            primaryTextColor: "#e0e0e0",
            primaryBorderColor: "#00E5FF",
            lineColor: "#00E5FF",
            secondaryColor: "#16213e",
            tertiaryColor: "#0f3460",
            fontFamily: "Poppins, sans-serif",
          },
          flowchart: { curve: "basis" },
        });
        return mermaid;
      })
      .catch((error) => {
        mermaidLoader = null;
        throw error;
      });
  }
  return mermaidLoader;
}

let idCounter = 0;

interface MermaidRendererProps {
  definition: string;
  className?: string;
  index?: number;
}

export function MermaidRenderer({
  definition,
  className,
  index,
}: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setSvg("");
    setError("");
    if (!definition.trim()) return;

    let cancelled = false;
    const id = `mermaid-${++idCounter}`;

    loadMermaid()
      .then((mermaid) => mermaid.render(id, definition.trim()))
      .then(({ svg: renderedSvg }) => {
        if (cancelled) return;
        const sanitized = DOMPurify.sanitize(renderedSvg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          ADD_TAGS: ["foreignObject", "text", "tspan", "textPath"],
          ADD_ATTR: [
            "dominant-baseline",
            "text-anchor",
            "dy",
            "font-family",
            "font-size",
          ],
        });
        setSvg(sanitized);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Invalid mermaid syntax");
        setSvg("");
      });

    return () => {
      cancelled = true;
    };
  }, [definition]);

  if (error) {
    return (
      <div
        data-mermaid-index={index}
        data-mermaid-state="error"
        className={`flex items-center justify-center p-4 text-xs text-red-400/70 ${className || ""}`}
      >
        <pre className="whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        data-mermaid-index={index}
        data-mermaid-state={definition.trim() ? "pending" : "empty"}
        className={className}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      data-mermaid-index={index}
      data-mermaid-state="ready"
      className={`flex items-center justify-center [&_svg]:max-w-full [&_svg]:max-h-full ${className || ""}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
