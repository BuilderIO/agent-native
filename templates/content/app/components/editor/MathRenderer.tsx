import { renderMathToHtml } from "@shared/math-rendering";
import { useEffect, useMemo, useRef } from "react";

interface MathRendererProps {
  latex: string;
  displayMode: boolean;
}

export function MathRenderer({ latex, displayMode }: MathRendererProps) {
  const targetRef = useRef<HTMLElement | null>(null);
  const rendered = useMemo(
    () => renderMathToHtml(latex, displayMode),
    [displayMode, latex],
  );

  useEffect(() => {
    const target = targetRef.current;
    if (!target || !rendered.ok) return;
    const parsed = new DOMParser().parseFromString(rendered.html, "text/html");
    target.replaceChildren(
      ...Array.from(parsed.body.childNodes, (node) =>
        target.ownerDocument.importNode(node, true),
      ),
    );
  }, [rendered]);

  if (!rendered.ok) {
    return (
      <code
        className={
          displayMode
            ? "content-math-error content-math-error--block"
            : "content-math-error content-math-error--inline"
        }
        title={rendered.error}
      >
        {latex || "Empty equation"}
      </code>
    );
  }

  return displayMode ? (
    <span
      ref={targetRef}
      className="content-math content-math--block"
      contentEditable={false}
    />
  ) : (
    <span
      ref={targetRef}
      className="content-math content-math--inline"
      contentEditable={false}
    />
  );
}
