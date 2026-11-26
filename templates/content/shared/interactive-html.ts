import {
  afterHiddenToken,
  decodeHtmlEntities,
  tokenizeHtml,
  type HiddenHtmlElement,
} from "./import/html-fragment.js";
import { isInteractiveHtmlLanguage } from "./interactive-html-language.js";
import { nfmToDoc, type PMNode } from "./nfm.js";
import {
  privateMediaIdFromSrc,
  privateMediaIdsInContent,
} from "./private-media.js";

export const INTERACTIVE_HTML_LIBRARY_ORIGIN = "https://cdn.jsdelivr.net";

export const MAX_INTERACTIVE_HTML_LENGTH = 200_000;

export const MAX_INTERACTIVE_HTML_IMAGES = 40;

const MAX_TITLE_LENGTH = 120;

export function interactiveHtmlTitle(source: string): string | null {
  const raw = /<title[^<>]*>([^<]*)<\/title\s*>/i.exec(source)?.[1] ?? "";
  const title = decodeHtmlEntities(raw).replace(/\s+/g, " ").trim();
  if (!title) return null;
  return title.length > MAX_TITLE_LENGTH
    ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : title;
}

export interface InteractiveHtmlBlock {
  source: string;
  title: string | null;
}

export function interactiveHtmlFromNode(
  node: PMNode,
): InteractiveHtmlBlock | null {
  if (
    node.type !== "codeBlock" ||
    !isInteractiveHtmlLanguage(node.attrs?.language)
  )
    return null;
  const source = (node.content ?? []).map((text) => text.text ?? "").join("");
  return { source, title: interactiveHtmlTitle(source) };
}

export function mayHoldInteractiveHtml(
  content: string | null | undefined,
): content is string {
  return !!content && /html\s+interactive/i.test(content);
}

export function interactiveHtmlBlocks(
  content: string | null | undefined,
): InteractiveHtmlBlock[] {
  if (!mayHoldInteractiveHtml(content)) return [];
  const blocks: InteractiveHtmlBlock[] = [];
  const visit = (node: PMNode) => {
    const block = interactiveHtmlFromNode(node);
    if (block) blocks.push(block);
    else node.content?.forEach(visit);
  };
  visit(nfmToDoc(content));
  return blocks;
}

export interface InteractiveHtmlDisplaySources {
  imageSources: readonly string[];
  mediaSources: readonly string[];
}

function sourcesAllow(sources: readonly string[], url: URL): boolean {
  return sources.some((source) => {
    if (source === url.protocol) return true;
    const origin = /^(https?:)\/\/(\*\.)?([^:/]+)(?::(\d+))?$/.exec(source);
    if (!origin) return false;
    const [, protocol, wildcard, host = "", port = ""] = origin;
    return (
      (url.protocol === protocol ||
        (protocol === "http:" && url.protocol === "https:")) &&
      url.port === port &&
      (wildcard ? url.hostname.endsWith(`.${host}`) : url.hostname === host)
    );
  });
}

function remoteUrl(value: string): URL | null {
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    // coercion-ok: a relative address is not a remote one.
    return null;
  }
}

function fromLibrary(value: string): boolean {
  return remoteUrl(value)?.origin === INTERACTIVE_HTML_LIBRARY_ORIGIN;
}

const LIBRARY_ADVICE = `Load it from ${INTERACTIVE_HTML_LIBRARY_ORIGIN} (npm packages are at ${INTERACTIVE_HTML_LIBRARY_ORIGIN}/npm/<package>@<version>/<file>) or write it inline.`;

const shown = (address: string) => address.slice(0, 120);

const scriptProblem = (address: string) =>
  `Scripts can't load from ${shown(address)}. ${LIBRARY_ADVICE}`;

const stylesheetProblem = (address: string) =>
  `Stylesheets and fonts can't load from ${shown(address)}. ${LIBRARY_ADVICE} Fonts are there too, such as ${INTERACTIVE_HTML_LIBRARY_ORIGIN}/npm/@fontsource/inter/index.css.`;

function mediaProblem(
  kind: "image" | "media",
  address: string,
  sources: readonly string[],
): string | null {
  if (/^(?:data:|blob:|#)/i.test(address)) return null;
  if (kind === "image" && privateMediaIdFromSrc(address)) return null;
  const url = remoteUrl(address);
  if (url && sourcesAllow(sources, url)) return null;
  const places = [
    ...(kind === "image"
      ? ["an image uploaded to Content (/api/private-media/<id>)"]
      : []),
    "a data: URL",
    ...sources.filter((source) => /^https?:/.test(source)),
  ];
  return `${kind === "image" ? "Images" : "Audio and video"} can't load from ${shown(address)}. Use one of: ${places.join(", ")}.`;
}

const MODULE_IMPORT_STRING_OR_COMMENT =
  /\b(?:from\s*|import\s*\(?\s*)["']((?:https?:\/|\.{0,2})\/[^"'\n]+)["']|\bimport\s*\(\s*`((?:https?:\/|\.{0,2})\/[^`$\s\\]+)(?:\\[\s\S]|[^\\`])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^\\`])*`|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;
const IMPORT_MAP_ADDRESS = /:\s*"((?:https?:\/|\.{0,2})\/[^"]+)"/g;

type Attributes = Readonly<Partial<Record<string, string>>>;

function scriptProblems(attrs: Attributes, code: string): string[] {
  const imports =
    attrs.type?.toLowerCase() === "importmap"
      ? IMPORT_MAP_ADDRESS
      : MODULE_IMPORT_STRING_OR_COMMENT;
  return [...code.matchAll(imports)].flatMap(
    ([, quoted = "", template = ""]) => {
      const address = quoted || template;
      return !address || fromLibrary(address) ? [] : [scriptProblem(address)];
    },
  );
}

const STYLE_COMMENT_OR_NAMESPACE = /\/\*[\s\S]*?(?:\*\/|$)|@namespace[^;]*;/gi;
const STYLE_IMPORT = /@import\s*(?:url\(\s*)?["']?([^"')\s;]+)[^;]*/gi;
const FONT_FACE = /@font-face\s*\{[^}]*\}?/gi;
const STYLE_URL = /\burl\(\s*(?:"([^"]+)|'([^']+)|([^"'\s)][^)]*))/gi;

const styleUrls = (css: string) =>
  [...css.matchAll(STYLE_URL)].map(([, double = "", single = "", bare = ""]) =>
    (double || single || bare).trim(),
  );

function styleProblems(
  css: string,
  allowed: InteractiveHtmlDisplaySources,
): (string | null)[] {
  const fromElsewhere: string[] = [];
  const rest = css
    .replace(STYLE_COMMENT_OR_NAMESPACE, "")
    .replace(STYLE_IMPORT, (_rule, address: string) => {
      fromElsewhere.push(address);
      return "";
    })
    .replace(FONT_FACE, (rule) => {
      fromElsewhere.push(
        ...styleUrls(rule).filter((address) => !/^data:/i.test(address)),
      );
      return "";
    });
  return [
    ...fromElsewhere.map((address) =>
      fromLibrary(address) ? null : stylesheetProblem(address),
    ),
    ...styleUrls(rest).map((address) =>
      mediaProblem("image", address, allowed.imageSources),
    ),
  ];
}

const SRCSET_CANDIDATE = /([^\s,](?:\S*[^\s,])?)(?:,+(?=\s|$)|[^,]*(?:,|$))/g;

const FRAME_ELEMENTS = new Set(["iframe", "frame", "object", "embed"]);

function elementProblems(
  name: string,
  attrs: Attributes,
  allowed: InteractiveHtmlDisplaySources,
): (string | null)[] {
  const image = (address: string | undefined) =>
    address ? mediaProblem("image", address, allowed.imageSources) : null;
  const media = (address: string | undefined) =>
    address ? mediaProblem("media", address, allowed.mediaSources) : null;
  const images = (srcset = "") =>
    [...srcset.matchAll(SRCSET_CANDIDATE)].map(([, address]) => image(address));
  if (FRAME_ELEMENTS.has(name)) {
    return [
      `<${name}> can't show another page inside the block. Put that page's own HTML in the block, or link to it from the page's text.`,
    ];
  }
  const src = attrs.src?.trim();
  const href = attrs.href?.trim();
  switch (name) {
    case "script":
      return [src && !fromLibrary(src) ? scriptProblem(src) : null];
    case "link": {
      const stylesheet = attrs.rel?.toLowerCase().split(/\s+/);
      return [
        href && stylesheet?.includes("stylesheet") && !fromLibrary(href)
          ? stylesheetProblem(href)
          : null,
      ];
    }
    case "img":
      return [image(src), ...images(attrs.srcset)];
    case "image":
      return [image(href ?? attrs["xlink:href"]?.trim())];
    case "source":
      return [media(src), ...images(attrs.srcset)];
    case "audio":
    case "track":
      return [media(src)];
    case "video":
      return [media(src), image(attrs.poster?.trim())];
    default:
      return [];
  }
}

const TEXT_ELEMENTS = new Set(["textarea", "title", "noscript"]);

export function interactiveHtmlProblems(
  source: string,
  allowed: InteractiveHtmlDisplaySources,
): string[] {
  if (source.trim() === "") {
    return ["It is empty. Put the page's HTML between the fence lines."];
  }
  if (source.length > MAX_INTERACTIVE_HTML_LENGTH) {
    return [
      `It is ${source.length} characters long and a block holds at most ${MAX_INTERACTIVE_HTML_LENGTH}. Load libraries from ${INTERACTIVE_HTML_LIBRARY_ORIGIN} and use images already uploaded to Content instead of writing them out.`,
    ];
  }
  const problems = new Set<string | null>();
  const images = privateMediaIdsInContent(source).size;
  if (images > MAX_INTERACTIVE_HTML_IMAGES) {
    problems.add(
      `It uses ${images} images uploaded to Content and a block shows at most ${MAX_INTERACTIVE_HTML_IMAGES}. Use fewer, or split it into two blocks.`,
    );
  }
  let skipped: HiddenHtmlElement | null = null;
  let opened: { name: string; attrs: Attributes } | null = null;
  for (const token of tokenizeHtml(source)) {
    if (skipped) {
      skipped = afterHiddenToken(skipped, token);
      continue;
    }
    const found: (string | null)[] = [];
    if (token.type === "text" && opened?.name === "script") {
      found.push(...scriptProblems(opened.attrs, token.text));
    } else if (token.type === "text" && opened?.name === "style") {
      found.push(...styleProblems(token.text, allowed));
    }
    opened = null;
    if (token.type === "open") {
      opened = token;
      if (TEXT_ELEMENTS.has(token.name)) {
        skipped = { name: token.name, depth: 1 };
      }
      found.push(
        ...elementProblems(token.name, opened.attrs, allowed),
        ...styleProblems(opened.attrs.style ?? "", allowed),
      );
    }
    for (const problem of found) problems.add(problem);
  }
  return [...problems].filter((problem) => problem !== null);
}

export function refusedInteractiveHtml(
  before: string | null | undefined,
  after: string,
  allowed: InteractiveHtmlDisplaySources,
): { title: string | null; problems: string[] } | null {
  const existing = interactiveHtmlBlocks(before).map(({ source }) => source);
  for (const { source, title } of interactiveHtmlBlocks(after)) {
    const kept = existing.indexOf(source);
    if (kept !== -1) {
      existing.splice(kept, 1);
      continue;
    }
    const problems = interactiveHtmlProblems(source, allowed);
    if (problems.length > 0) return { title, problems };
  }
  return null;
}
