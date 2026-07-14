import { renderMathToHtml } from "@shared/math-rendering";
import { useMemo } from "react";

interface MathRendererProps {
  latex: string;
  displayMode: boolean;
}

export function MathRenderer({ latex, displayMode }: MathRendererProps) {
  const rendered = useMemo(
    () => renderMathToHtml(latex, displayMode),
    [displayMode, latex],
  );

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
      className="content-math content-math--block"
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  ) : (
    <span
      className="content-math content-math--inline"
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}
