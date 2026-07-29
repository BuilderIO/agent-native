type HtmlInjectionTarget = "head" | "body";

function closingTagIndex(
  html: string,
  tag: HtmlInjectionTarget | "html",
  last: boolean,
): number {
  const pattern = new RegExp(`<\\/${tag}\\s*>`, "gi");
  let index = -1;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    index = match.index;
    if (!last) return index;
  }

  return index;
}

/**
 * Inserts markup at a document boundary without using String.replace's
 * replacement-string semantics. Body and html closers use their last marker
 * so literal close tags inside scripts or text cannot capture the injection.
 */
export function injectDocumentMarkup(
  html: string,
  markup: string,
  options: { target?: HtmlInjectionTarget } = {},
): string {
  if (!markup) return html;

  const target = options.target ?? "body";
  const targetIndex = closingTagIndex(html, target, target === "body");
  if (targetIndex !== -1) {
    return html.slice(0, targetIndex) + markup + html.slice(targetIndex);
  }

  const bodyIndex = closingTagIndex(html, "body", true);
  if (bodyIndex !== -1) {
    return html.slice(0, bodyIndex) + markup + html.slice(bodyIndex);
  }

  const htmlIndex = closingTagIndex(html, "html", true);
  if (htmlIndex !== -1) {
    return html.slice(0, htmlIndex) + markup + html.slice(htmlIndex);
  }

  return html + markup;
}
