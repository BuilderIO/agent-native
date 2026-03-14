import TurndownService from "turndown";

const turndownService1 = new TurndownService({
  emDelimiter: "*",
  strongDelimiter: "**",
});

const turndownService2 = new TurndownService({
  emDelimiter: "*",
  strongDelimiter: "**",
});
function wrapEmphasis(content: string, delimiter: string): string {
  if (!content.trim()) return content;
  const parts = content.split(/(`[^`]+`)/g);
  if (parts.length === 1) {
    const leadingSpace = content.match(/^\s*/)?.[0] || "";
    const trailingSpace = content.match(/\s*$/)?.[0] || "";
    return `${leadingSpace}${delimiter}${content.trim()}${delimiter}${trailingSpace}`;
  }
  return parts
    .map((part) => {
      if (part.startsWith("`")) return part;
      if (!part) return "";
      const leadingSpace = part.match(/^\s*/)?.[0] || "";
      const trailingSpace = part.match(/\s*$/)?.[0] || "";
      const trimmed = part.trim();
      if (!trimmed) return part;
      return `${leadingSpace}${delimiter}${trimmed}${delimiter}${trailingSpace}`;
    })
    .join("");
}
turndownService2.addRule("emphasis", {
  filter: ["em", "i"],
  replacement: (content, node, options) =>
    wrapEmphasis(content, options.emDelimiter as string),
});

const html =
  "<p>Here is <em>some <code>code</code> block</em> and <strong>bold <code>code</code> too</strong>.</p>";
console.log("Default:");
console.log(turndownService1.turndown(html));
console.log("Custom:");
console.log(turndownService2.turndown(html));
