import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let initialized = false;
let idCounter = 0;

function initMermaid() {
  if (initialized) return;
  initialized = true;
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
}

interface MermaidRendererProps {
  definition: string;
  className?: string;
}

export function MermaidRenderer({
  definition,
  className,
}: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!definition.trim()) return;
    initMermaid();

    let cancelled = false;
    const id = `mermaid-${++idCounter}`;

    mermaid
      .render(id, definition.trim())
      .then(({ svg: renderedSvg }) => {
        if (cancelled) return;
        setSvg(renderedSvg);
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
        className={`flex items-center justify-center p-4 text-xs text-red-400/70 ${className || ""}`}
      >
        <pre className="whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  if (!svg) return null;

  return (
    <div
      ref={containerRef}
      className={`flex items-center justify-center [&_svg]:max-w-full [&_svg]:max-h-full ${className || ""}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
