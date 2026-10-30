/**
 * Comment bodies are Markdown. Emails, webhooks and other text-only readers
 * want what a person sees instead: these helpers drop the markers and keep the
 * words. They read the comment with the parser the toolkit's comment renderer
 * uses (CommonMark with GitHub's extensions), so the text matches the screen.
 */

import type {
  FootnoteDefinition,
  ListItem,
  Nodes,
  PhrasingContent,
  RootContent,
} from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/**
 * A comment shows Markdown for this many characters and plain text after, so
 * one huge comment can't stall the page that renders it, or the email or
 * webhook that quotes it.
 */
export const COMMENT_MARKDOWN_LIMIT = 20_000;

/*
 * The parser's time grows with the square of a paragraph's emphasis markers,
 * and faster still with brackets, quotes and lists nested inside each other:
 * a few thousand characters of them take it seconds, or overflow its stack. A
 * paragraph past any of these, far beyond what people write, shows as written.
 */
/** `*`, `_` and `~` in one paragraph. */
const MAX_EMPHASIS_MARKERS = 1_000;
/** `<!--` in one paragraph; the parser looks ahead from each for its end. */
const MAX_HTML_COMMENTS = 64;
/** Brackets open inside each other. */
const MAX_BRACKET_DEPTH = 16;
/**
 * Characters the parser looks back over for brackets in one paragraph. Each
 * `]` looks back for the `[` it closes, or to the paragraph's start when none
 * is open, and while a `[` is open, each word looks back to it for a bare
 * link it can't start inside a label.
 */
const MAX_BRACKET_LOOKBACK = 500_000;
/** Quote and list markers opening one line, as in `> > - 1. text`. */
const MAX_LINE_NESTING = 16;
/**
 * Cells in one table. The renderer gives every row as many cells as the
 * table has columns, filling in empty ones, so a table 300 columns wide with
 * rows of one cell each draws 300 per row, and a few thousand characters of
 * them take it seconds.
 */
const MAX_TABLE_CELLS = 5_000;

/**
 * Splits a comment where its Markdown stops: before the first paragraph too
 * tangled for the parser to read quickly, or else at a paragraph break near
 * the limit, so the Markdown part doesn't end inside a block when it can help
 * it. Rather than end inside a fenced code block, it stops before the block,
 * which then shows as written with the rest.
 */
export function splitCommentAtMarkdownLimit(body: string): {
  markdown: string;
  rest: string;
} {
  // Nothing past the limit is read as Markdown, so nothing past it is read.
  const { tangledAt, fences } = readCommentLines(
    body.slice(0, COMMENT_MARKDOWN_LIMIT),
  );
  let cut = tangledAt;
  if (cut === undefined) {
    if (body.length <= COMMENT_MARKDOWN_LIMIT) {
      return { markdown: body, rest: "" };
    }
    const head = body.slice(0, COMMENT_MARKDOWN_LIMIT);
    const paragraphBreak = head.lastIndexOf("\n\n");
    let limitCut =
      paragraphBreak > COMMENT_MARKDOWN_LIMIT / 2
        ? paragraphBreak
        : COMMENT_MARKDOWN_LIMIT;
    const last = body.charCodeAt(limitCut - 1);
    if (last >= 0xd800 && last <= 0xdbff) limitCut -= 1;
    const split = fences.find(
      (fence) => fence.start < limitCut && limitCut < fence.end,
    );
    cut = split ? split.start : limitCut;
  }
  return {
    markdown: body.slice(0, cut),
    rest: body.slice(cut).replace(/^\n+/, ""),
  };
}

/**
 * Whether a paragraph in `markdown` is too tangled for the parser to read
 * quickly, by the same measure `splitCommentAtMarkdownLimit` cuts at. A
 * renderer that changes a comment's text before parsing it, as one that draws
 * mentions as links does, asks this of the text it will parse.
 */
export function isCommentMarkdownTangled(markdown: string): boolean {
  return readCommentLines(markdown).tangledAt !== undefined;
}

/** The links `commentLinkRanges` finds, and the definitions that make some. */
const LINK_NODES = new Set<Nodes["type"]>([
  "link",
  "linkReference",
  "image",
  "imageReference",
  "definition",
]);

/**
 * Where a comment's links sit, as offsets into `markdown`, in order: links and
 * images written inline or by reference, autolinks, bare URLs and addresses
 * GitHub's extensions link, and the definitions references use. The parser
 * finds them as the renderer does, so a renderer that draws `@` mentions as
 * links can leave a mention inside one to that link. Only the Markdown part
 * `splitCommentAtMarkdownLimit` keeps is read; the rest has no links.
 */
export function commentLinkRanges(
  markdown: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const visit = (node: Nodes) => {
    if (LINK_NODES.has(node.type)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) ranges.push({ start, end });
    } else if ("children" in node) {
      node.children.forEach(visit);
    }
  };
  try {
    visit(
      fromMarkdown(splitCommentAtMarkdownLimit(markdown).markdown, {
        extensions: [gfm()],
        mdastExtensions: [gfmFromMarkdown()],
      }),
    );
  } catch {
    // Should the parser fail, the renderer shows the comment as written,
    // with no links in it.
    return [];
  }
  return ranges;
}

/**
 * A code block fenced at the left margin, from the start of its opening line
 * to the end of its closing line (Infinity if it doesn't close within the
 * limit).
 */
interface Fence {
  start: number;
  end: number;
}

/**
 * Reads a comment's lines: where the first paragraph that passes the limits
 * above starts, if one does, and where its fenced code blocks sit. Code isn't
 * Markdown, so it isn't counted. A blank line or a fence always ends a
 * paragraph, so counting between them never counts too few.
 */
function readCommentLines(body: string): {
  tangledAt: number | undefined;
  fences: Fence[];
} {
  const fences: Fence[] = [];
  let fence: (OpeningFence & { start: number }) | undefined;
  // Only fences outside any quote, list or footnote are followed: at the
  // left margin, or up to three spaces in before any line has opened one. A
  // fence inside one could be closed by a line that looks like it opens one,
  // so after a fence marker the scan doesn't follow, it stops trusting fences
  // and counts everything. A fence line inside an HTML block is HTML: most
  // blocks end at a blank line, so until one no fence opens, but a comment,
  // `<pre>`, `<script>` and a few others run past blank lines, so after a line
  // that could open one of those the scan stops trusting fences too.
  let trustFences = true;
  let html = false;
  let containers = false;
  let paragraph = 0;
  let emphasis = 0;
  let htmlComments = 0;
  // Where each `[` still open in the paragraph sits.
  let brackets: number[] = [];
  let lookback = 0;
  // Columns of a table opened in the paragraph, the quotes its delimiter row
  // sits in, and the cells drawn so far.
  let tableColumns = 0;
  let tableQuotes = 0;
  let tableCells = 0;
  let start = 0;
  while (start < body.length) {
    // Lines end as the parser ends them: at `\n`, `\r\n` or a lone `\r`.
    let end = start;
    while (end < body.length && !isLineEnding(body.charAt(end))) end += 1;
    const next = end + (body.startsWith("\r\n", end) ? 2 : 1);
    let at = start;
    while (at < end && isSpace(body.charAt(at))) at += 1;
    const indent = at - start;
    const opening =
      fence === undefined &&
      trustFences &&
      !html &&
      (indent === 0 ||
        (!containers && indent <= 3 && !body.slice(start, at).includes("\t")))
        ? openingFence(body, at, end)
        : undefined;
    if (fence !== undefined) {
      if (closesFence(body, start, end, fence)) {
        fences.push({ start: fence.start, end });
        fence = undefined;
        paragraph = next;
      }
    } else if (at === end || opening !== undefined) {
      if (opening !== undefined) fence = { ...opening, start };
      else html = false;
      paragraph = next;
      emphasis = 0;
      htmlComments = 0;
      brackets = [];
      lookback = 0;
      tableColumns = 0;
      tableCells = 0;
    } else {
      const text = body.slice(at, end);
      if (text.startsWith("<")) html = true;
      if (
        opensLongHtmlBlock(text) ||
        text.includes("```") ||
        text.includes("~~~")
      ) {
        trustFences = false;
      }
      const { quotes, lists } = lineMarkers(body, at, end);
      const nesting = quotes + lists;
      if (nesting > MAX_LINE_NESTING) return { tangledAt: paragraph, fences };
      if (nesting > 0 || text.startsWith("[^")) containers = true;
      // A row after a delimiter row draws the table's full width, as do the
      // header and the delimiter row itself. A line that opens a list item,
      // sits in more or fewer quotes, or is a heading or thematic break ends
      // the table; the cells it drew still count.
      if (
        lists > 0 ||
        quotes !== tableQuotes ||
        startsHeadingOrBreak(body, at, end)
      ) {
        tableColumns = 0;
      }
      const columns = delimiterRowColumns(text);
      if (columns > 0) {
        tableColumns = Math.max(tableColumns, columns);
        tableQuotes = quotes;
        tableCells += tableColumns;
      }
      tableCells += tableColumns;
      if (tableCells > MAX_TABLE_CELLS) return { tangledAt: paragraph, fences };
      for (let index = at; index < end; index += 1) {
        const char = body.charAt(index);
        if (char === "*" || char === "_" || char === "~") {
          emphasis += 1;
          if (emphasis > MAX_EMPHASIS_MARKERS) {
            return { tangledAt: paragraph, fences };
          }
        } else if (char === "[") {
          brackets.push(index);
          if (brackets.length > MAX_BRACKET_DEPTH) {
            return { tangledAt: paragraph, fences };
          }
        } else if (char === "]") {
          lookback += index - (brackets.pop() ?? paragraph);
        } else if (char === "<" && body.startsWith("<!--", index)) {
          htmlComments += 1;
          if (htmlComments > MAX_HTML_COMMENTS) {
            return { tangledAt: paragraph, fences };
          }
        } else if (brackets.length > 0 && startsBareLink(body, index)) {
          lookback += index - (brackets.at(-1) ?? index);
        }
        if (lookback > MAX_BRACKET_LOOKBACK) {
          return { tangledAt: paragraph, fences };
        }
      }
    }
    start = next;
  }
  if (fence !== undefined) fences.push({ start: fence.start, end: Infinity });
  return { tangledAt: undefined, fences };
}

/**
 * How many columns a line gives a table if it's a delimiter row, like
 * `| --- | :-: |` or `> |-|-|` in a quote, or else 0. Every pipe is counted as
 * a column break, so it counts a column or two too many rather than too few.
 */
function delimiterRowColumns(text: string): number {
  let pipes = 0;
  let dashes = false;
  let quoted = true;
  for (const char of text) {
    if (char === "|") pipes += 1;
    else if (char === "-") dashes = true;
    else if (char === ">" && quoted) continue;
    else if (char !== ":" && !isSpace(char)) return 0;
    if (!isSpace(char)) quoted = false;
  }
  return pipes > 0 && dashes ? pipes + 1 : 0;
}

/**
 * Whether the line from `at` to `end`, past any quote markers, opens an ATX
 * heading (`#` to `######`, then a space or the line's end) or is a thematic
 * break (three or more of one of `-*_`, spaced or not).
 */
function startsHeadingOrBreak(body: string, at: number, end: number): boolean {
  while (at < end && (isSpace(body.charAt(at)) || body.charAt(at) === ">")) {
    at += 1;
  }
  let hashes = at;
  while (hashes < end && body.charAt(hashes) === "#") hashes += 1;
  if (
    hashes > at &&
    hashes - at <= 6 &&
    (hashes === end || isSpace(body.charAt(hashes)))
  ) {
    return true;
  }
  const marker = body.charAt(at);
  if (marker !== "-" && marker !== "*" && marker !== "_") return false;
  let markers = 0;
  for (let index = at; index < end; index += 1) {
    const char = body.charAt(index);
    if (char === marker) markers += 1;
    else if (!isSpace(char)) return false;
  }
  return markers >= 3;
}

/**
 * Whether a line could open an HTML block that runs past blank lines: a
 * comment, `<?`, a `<!` declaration or CDATA, or `<pre>`, `<script>`,
 * `<style>` or `<textarea>`.
 */
function opensLongHtmlBlock(text: string): boolean {
  if (text.startsWith("<!") || text.startsWith("<?")) return true;
  const tag = text.slice(1, 9).toLowerCase();
  return ["pre", "script", "style", "textarea"].some((name) =>
    tag.startsWith(name),
  );
}

interface OpeningFence {
  marker: string;
  length: number;
}

/** The fence a line opens, if it opens one, from its first marker. */
function openingFence(
  body: string,
  start: number,
  end: number,
): OpeningFence | undefined {
  const marker = body.charAt(start);
  if (marker !== "`" && marker !== "~") return undefined;
  let at = start;
  while (at < end && body.charAt(at) === marker) at += 1;
  if (at - start < 3) return undefined;
  // A backtick in a backtick fence's info string makes the line text.
  if (marker === "`" && body.slice(at, end).includes("`")) return undefined;
  return { marker, length: at - start };
}

/**
 * Whether a line closes the fence: up to three spaces, at least as many of
 * the fence's markers, and nothing else.
 */
function closesFence(
  body: string,
  start: number,
  end: number,
  fence: OpeningFence,
): boolean {
  let at = start;
  while (at < end && at - start < 3 && body.charAt(at) === " ") at += 1;
  const markers = at;
  while (at < end && body.charAt(at) === fence.marker) at += 1;
  if (at - markers < fence.length) return false;
  while (at < end && isSpace(body.charAt(at))) at += 1;
  return at === end;
}

/** How many quote and list markers open the line from `at` to `end`. */
function lineMarkers(
  body: string,
  at: number,
  end: number,
): { quotes: number; lists: number } {
  let quotes = 0;
  let lists = 0;
  for (;;) {
    while (at < end && isSpace(body.charAt(at))) at += 1;
    const char = body.charAt(at);
    if (char === ">") {
      quotes += 1;
      at += 1;
      continue;
    }
    let marker = at;
    if (char === "-" || char === "+" || char === "*") {
      marker += 1;
    } else {
      while (marker - at < 9 && isDigit(body.charAt(marker))) marker += 1;
      const delimiter = body.charAt(marker);
      if (marker === at || (delimiter !== "." && delimiter !== ")")) {
        return { quotes, lists };
      }
      marker += 1;
    }
    // A list marker is followed by a space or ends the line.
    if (marker < end && !isSpace(body.charAt(marker))) {
      return { quotes, lists };
    }
    lists += 1;
    at = marker;
  }
}

/**
 * Whether GitHub's Markdown could start a bare email or URL here, as it
 * tries to after anything but a letter, digit or `+-._`, and for `http`
 * after anything but a letter.
 */
function startsBareLink(body: string, index: number): boolean {
  const char = body.charAt(index);
  const previous = body.charAt(index - 1);
  return (
    (isAtext(char) && !isAtext(previous)) ||
    ((char === "h" || char === "H") && !isAsciiLetter(previous))
  );
}

function isAtext(char: string): boolean {
  return (
    isAsciiLetter(char) ||
    isDigit(char) ||
    char === "+" ||
    char === "-" ||
    char === "." ||
    char === "_"
  );
}

function isAsciiLetter(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}

function isSpace(char: string): boolean {
  return char === " " || char === "\t";
}

function isLineEnding(char: string): boolean {
  return char === "\n" || char === "\r";
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

/**
 * A comment as plain text. Emphasis, heading, quote and code markers go;
 * links keep their text, so `@[Name](mailto:…)` mentions read `@Name`; HTML
 * comments, images, rules and task checkboxes drop, as the renderer skips
 * them. Footnotes read as the renderer numbers them, `[1]` in the text and the
 * notes at the end, and a note nothing cites drops, as it does on screen.
 * Other raw HTML, code, list markers and line breaks stay as written, and
 * blocks keep the blank lines the author put between them. Where the
 * Markdown stops, at the limit or a paragraph too tangled to read quickly,
 * the rest stays as written, as the renderer shows it.
 */
export function commentPlainText(markdown: string): string {
  const text = markdown.replace(/\r\n?/g, "\n");
  const { markdown: head, rest } = splitCommentAtMarkdownLimit(text);
  let read: string;
  try {
    const tree = fromMarkdown(head, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
    const footnotes = new Footnotes(tree);
    read = [blocks(tree.children, footnotes), footnotes.section()]
      .filter(Boolean)
      .join("\n\n");
  } catch {
    // Should the parser fail on something the split didn't catch, the
    // renderer shows the comment as written, and so does this.
    return text.trim();
  }
  return [read, rest]
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A comment on one line, cut to `limit` characters with an ellipsis, for an
 * email or notification that quotes it.
 */
export function commentExcerpt(markdown: string, limit = 240): string {
  const collapsed = commentPlainText(markdown).replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  let cut = limit - 1;
  // Don't leave half of a character outside the Basic Multilingual Plane.
  const last = collapsed.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${collapsed.slice(0, cut).trimEnd()}…`;
}

/**
 * Blocks one after another, with a blank line between two the author
 * separated by one and a line break otherwise. Blocks the renderer draws
 * nothing for leave no gap.
 */
function blocks(nodes: readonly RootContent[], footnotes: Footnotes): string {
  let text = "";
  let previous: RootContent | undefined;
  for (const node of nodes) {
    const block = blockText(node, footnotes);
    if (block === null) continue;
    if (previous) text += gapBetween(previous, node);
    text += block;
    previous = node;
  }
  return text;
}

function gapBetween(previous: Nodes, next: Nodes): string {
  const end = previous.position?.end.line;
  const start = next.position?.start.line;
  return end !== undefined && start !== undefined && start - end <= 1
    ? "\n"
    : "\n\n";
}

/** A block's text, or null for one the renderer draws nothing for. */
function blockText(node: RootContent, footnotes: Footnotes): string | null {
  switch (node.type) {
    case "paragraph":
    case "heading": {
      const text = phrasing(node.children, footnotes);
      return text.trim() ? text : null;
    }
    case "code":
      return node.value;
    case "blockquote":
      return blocks(node.children, footnotes) || null;
    case "footnoteDefinition":
      // Read at the end, with the other notes the text cites.
      return null;
    case "list": {
      let text = "";
      let number = node.start ?? 1;
      let previous: ListItem | undefined;
      for (const item of node.children) {
        if (previous) text += gapBetween(previous, item);
        const marker = node.ordered ? `${number}. ` : "- ";
        // An item's later lines sit under its first, past the marker.
        const content = blocks(item.children, footnotes).replace(
          /\n(?=[^\n])/g,
          `\n${" ".repeat(marker.length)}`,
        );
        text += `${marker}${content}`.trimEnd();
        number += 1;
        previous = item;
      }
      return text;
    }
    case "table":
      return node.children
        .map((row) =>
          row.children
            .map((cell) => phrasing(cell.children, footnotes))
            .join(" | "),
        )
        .join("\n");
    case "html": {
      const text = withoutHtmlComments(node.value).trim();
      return text || null;
    }
    case "thematicBreak":
    case "definition":
    case "yaml":
      // The renderer draws no text for rules or link definitions.
      return null;
    case "listItem":
    case "tableRow":
    case "tableCell":
      // Read with their list or table.
      return null;
    case "text":
    case "inlineCode":
    case "break":
    case "emphasis":
    case "strong":
    case "delete":
    case "link":
    case "linkReference":
    case "image":
    case "imageReference":
    case "footnoteReference":
      // A parse never puts these outside a block, but read them if it does.
      return phrasingText(node, footnotes) || null;
  }
}

function phrasing(
  nodes: readonly PhrasingContent[],
  footnotes: Footnotes,
): string {
  return nodes.map((node) => phrasingText(node, footnotes)).join("");
}

function phrasingText(node: PhrasingContent, footnotes: Footnotes): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "inlineCode":
      // A line break inside code reads as a space, as the renderer draws it.
      return node.value.replace(/\r?\n|\r/g, " ");
    case "break":
      return "\n";
    case "emphasis":
    case "strong":
    case "delete":
    case "link":
    case "linkReference":
      return phrasing(node.children, footnotes);
    case "html":
      return withoutHtmlComments(node.value);
    case "image":
    case "imageReference":
      // The renderer draws no text for images.
      return "";
    case "footnoteReference":
      return `[${footnotes.cite(node.identifier)}]`;
  }
}

/**
 * A comment's footnotes, numbered as the renderer numbers them: in the order
 * the text first cites each, and a note cited only in another note after it.
 */
class Footnotes {
  private readonly notes = new Map<string, FootnoteDefinition>();
  private readonly numbers = new Map<string, number>();
  private readonly cited: FootnoteDefinition[] = [];

  constructor(tree: Nodes) {
    // The renderer finds a note wherever it's defined, and of two with one
    // label it keeps the first.
    const visit = (node: Nodes) => {
      if (
        node.type === "footnoteDefinition" &&
        !this.notes.has(node.identifier)
      ) {
        this.notes.set(node.identifier, node);
      }
      if ("children" in node) node.children.forEach(visit);
    };
    visit(tree);
  }

  /** The number a citation of the note shows. */
  cite(identifier: string): number {
    let number = this.numbers.get(identifier);
    if (number === undefined) {
      const note = this.notes.get(identifier);
      if (note) this.cited.push(note);
      number = this.cited.length;
      this.numbers.set(identifier, number);
    }
    return number;
  }

  /**
   * The cited notes in order, under the heading the renderer gives them, or
   * nothing when the text cites none.
   */
  section(): string {
    const items: string[] = [];
    // Reading a note can cite another, which joins the end of the list.
    for (const [index, note] of this.cited.entries()) {
      const marker = `${index + 1}. `;
      const content = blocks(note.children, this).replace(
        /\n(?=[^\n])/g,
        `\n${" ".repeat(marker.length)}`,
      );
      items.push(`${marker}${content}`.trimEnd());
    }
    return items.length ? `Footnotes\n${items.join("\n")}` : "";
  }
}

// An opening tag, as CommonMark reads one, or an HTML comment. A comment
// left open runs to the end, as the parser reads it.
const TAG_OR_HTML_COMMENT =
  /<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<!--(?:-?>|.*?(?:-->|$))/gs;

/**
 * Raw HTML as the renderer shows it: as written, since in a comment it's
 * usually prose about markup, like `use <Button> here`, but without its HTML
 * comments. A `<!--` in a tag's quoted attribute is part of the tag, as in
 * `<a title="<!--">`, and stays. The toolkit's renderer strips them with this
 * too, so the screen and the text agree.
 */
export function withoutHtmlComments(html: string): string {
  return html.replace(TAG_OR_HTML_COMMENT, (match) =>
    match.startsWith("<!--") ? "" : match,
  );
}
