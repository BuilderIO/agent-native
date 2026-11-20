import * as React from "react";

/**
 * Wraps each run of text among a part's children in a span, adjacent strings
 * and numbers together, so the part's CSS can tell a glyph that leads its
 * label (`> svg:first-child`) from one that trails it.
 */
export function labelText(children: React.ReactNode): React.ReactNode {
  const out: React.ReactNode[] = [];
  let run: Array<string | number> = [];
  const flush = () => {
    if (run.length === 0) return;
    const text = run.join("");
    out.push(
      text.trim() === "" ? (
        text
      ) : (
        <span key={`label-${out.length}`}>{text}</span>
      ),
    );
    run = [];
  };
  React.Children.forEach(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      run.push(child);
      return;
    }
    flush();
    if (child !== null && child !== undefined && typeof child !== "boolean") {
      out.push(child);
    }
  });
  flush();
  return out;
}
