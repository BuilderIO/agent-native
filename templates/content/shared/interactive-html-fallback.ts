import { contentBlockLinkPath, readFullScreenBlockLink } from "./block-link.js";
import { visitBlocksFieldBlocks } from "./blocks-field-identity.js";
import {
  INTERACTIVE_HTML_LANGUAGE,
  isInteractiveHtmlLanguage,
  withInteractiveHtmlNote,
} from "./interactive-html-language.js";
import {
  interactiveHtmlTitle,
  mayHoldInteractiveHtml,
} from "./interactive-html.js";
import { docToNfm, nfmToDoc, soleLinkHref, type PMNode } from "./nfm.js";

function linkLabel(source: string): string {
  const title = interactiveHtmlTitle(source)
    ?.replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/[\s\\*_~`<>]+/g, " ")
    .trim();
  return title ? `Open “${title}”` : "Open the interactive block";
}

function linkParagraph(source: string, url: string): PMNode {
  return {
    type: "paragraph",
    content: [
      {
        type: "text",
        text: linkLabel(source),
        marks: [{ type: "link", attrs: { href: url } }],
      },
    ],
  };
}

function codeBlock(language: string, code: string): PMNode {
  return {
    type: "codeBlock",
    attrs: { language },
    content: code ? [{ type: "text", text: code }] : [],
  };
}

const markdownOf = (node: PMNode) =>
  docToNfm({ type: "doc", content: [node] }).split("\n");

const linesOf = (content: string) =>
  content.replace(/\r\n?/g, "\n").split("\n");

const textOf = (node: PMNode) =>
  (node.content ?? []).map((run) => run.text ?? "").join("");

interface MarkedLine {
  line: number;
  path: string;
  node: PMNode;
  withoutMarks: (text: string) => string;
}

function readMarkedLines(
  lines: readonly string[],
  mark: (line: string, mark: string) => string,
  markedText: (node: PMNode) => unknown,
): MarkedLine[] {
  const content = lines.join("\n");
  let edge = "\u{E000}";
  while (content.includes(edge)) edge += "\u{E000}";
  const marks = new RegExp(`${edge}(\\d+)${edge}`, "gu");
  const withoutMarks = (text: string) => text.replace(marks, "");
  const found: MarkedLine[] = [];
  const doc = nfmToDoc(
    lines.map((line, index) => mark(line, `${edge}${index}${edge}`)).join("\n"),
  );
  visitBlocksFieldBlocks(doc, (node, { path }) => {
    const text = markedText(node);
    if (typeof text !== "string") return;
    const [, line] = [...text.matchAll(marks)][0] ?? [];
    if (line) found.push({ line: Number(line), path, node, withoutMarks });
  });
  return found;
}

const FENCE_OPEN = /^([\t ]*)(`{3,}|~{3,})(.*html\s+interactive.*)$/i;

interface InteractiveHtmlFence {
  path: string;
  source: string;
  first: number;
  end: number;
  indent: string;
}

function interactiveHtmlFences(
  content: string | null | undefined,
): InteractiveHtmlFence[] {
  if (!mayHoldInteractiveHtml(content)) return [];
  const lines = linesOf(content);
  return readMarkedLines(
    lines,
    (line, mark) => line.replace(FENCE_OPEN, `$1$2${mark}$3`),
    (node) => (node.type === "codeBlock" ? node.attrs?.language : null),
  ).flatMap(({ line, path, node, withoutMarks }) => {
    if (!isInteractiveHtmlLanguage(withoutMarks(String(node.attrs?.language))))
      return [];
    const [, indent = "", marker = ""] =
      FENCE_OPEN.exec(lines[line] ?? "") ?? [];
    const source = withoutMarks(textOf(node));
    const closes = (index: number) => {
      const close = lines[index]?.trim() ?? "";
      return (
        close.length >= marker.length &&
        close === marker.charAt(0).repeat(close.length)
      );
    };
    const body = source || !closes(line + 1) ? source.split("\n").length : 0;
    const after = line + 1 + body;
    return [
      {
        path,
        source,
        first: line,
        end: closes(after) ? after + 1 : after,
        indent,
      },
    ];
  });
}

function replaceInteractiveHtml(
  content: string,
  replacement: (fence: InteractiveHtmlFence) => PMNode[],
): string {
  const fences = interactiveHtmlFences(content);
  if (fences.length === 0) return content;
  const lines = linesOf(content);
  for (const fence of fences.reverse()) {
    const apart = fence.indent.includes(" ") ? [""] : [];
    const written = replacement(fence).flatMap((node) => [
      ...apart,
      ...markdownOf(node).map((line) => fence.indent + line),
    ]);
    lines.splice(fence.first, fence.end - fence.first, ...written);
  }
  return lines.join("\n");
}

export type InteractiveHtmlUrl = (block: { path: string }) => string;

export function interactiveHtmlAsLinks(
  content: string,
  url: InteractiveHtmlUrl,
): string {
  return replaceInteractiveHtml(content, (block) => [
    linkParagraph(block.source, url(block)),
  ]);
}

export function interactiveHtmlForNotion(
  markdown: string,
  url: InteractiveHtmlUrl,
): string {
  return replaceInteractiveHtml(markdown, (block) => {
    const address = url(block);
    return [
      codeBlock("html", withInteractiveHtmlNote(block.source, address)),
      linkParagraph(block.source, address),
    ];
  });
}

function lastHref(line: string): string | null {
  const end = /\)[\s*_~]*$/.exec(line)?.index ?? -1;
  const open = line.lastIndexOf("](", end);
  return open < 0 || end < 0 ? null : line.slice(open + 2, end);
}

const lettersOf = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, "");

function readCaptions(lines: readonly string[], documentId: string) {
  const pagePath = contentBlockLinkPath(documentId, null);
  const linkIn = (line: string) => {
    const href = lastHref(line);
    const link = readFullScreenBlockLink(href);
    return href && link?.pagePath === pagePath
      ? { href, blockId: link.blockId }
      : null;
  };
  return readMarkedLines(
    lines,
    (line, mark) => {
      const link = linkIn(line);
      return link ? line.split(link.href).join(link.href + mark) : line;
    },
    soleLinkHref,
  ).flatMap(({ line, node }) => {
    const text = lines[line] ?? "";
    const link = linkIn(text);
    return link
      ? [
          {
            line,
            indent: /^[\t ]*/.exec(text)?.[0] ?? "",
            label: lettersOf(textOf(node)),
            blockId: link.blockId,
          },
        ]
      : [];
  });
}

export function keepInteractiveHtml(args: {
  local: string | null | undefined;
  incoming: string;
  documentId: string;
  blockIds: Readonly<Record<string, string>>;
}): string {
  const blocks = interactiveHtmlFences(args.local).map((block) => ({
    ...block,
    id: args.blockIds[block.path] ?? null,
    label: lettersOf(linkLabel(block.source)),
  }));
  if (blocks.length === 0) return args.incoming;
  const lines = linesOf(args.incoming);
  const captions = readCaptions(lines, args.documentId);
  const ids = new Set(blocks.map(({ id }) => id));
  const named = captions.filter(({ blockId }) => blockId && ids.has(blockId));
  const unnamed = captions.filter((caption) => !named.includes(caption));
  const left = new Set(blocks);
  const written = new Map<number, string>();
  const restore = (
    { line, indent }: (typeof captions)[number],
    block: (typeof blocks)[number] | undefined,
  ) => {
    if (!block || !left.delete(block)) return;
    written.set(
      line,
      markdownOf(codeBlock(INTERACTIVE_HTML_LANGUAGE, block.source))
        .map((code) => indent + code)
        .join("\n"),
    );
  };
  for (const caption of named) {
    restore(
      caption,
      blocks.find(({ id }) => id === caption.blockId),
    );
  }
  for (const caption of unnamed) {
    const alike = ({ label }: { label: string }) => label === caption.label;
    const [block, ...others] = [...left].filter(alike);
    if (others.length === 0 && unnamed.filter(alike).length === 1) {
      restore(caption, block);
    }
  }
  return lines.map((line, index) => written.get(index) ?? line).join("\n");
}
