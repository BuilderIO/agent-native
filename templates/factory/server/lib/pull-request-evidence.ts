/**
 * What a pull request description says about how its change was checked: the
 * `### Verified` section Builder is asked to write. Only a bounded, stripped
 * summary leaves this module; the body itself never does.
 */
export interface PullRequestVerification {
  /** A Verified heading with at least some text or a screenshot or recording under it. */
  present: boolean;
  /** The section holds an image, a video or a link to a recording. */
  hasMedia: boolean;
  /** The start of the section as plain text: no HTML, no URLs. May be set while `present` is false. */
  excerpt: string;
}

export const VERIFICATION_EXCERPT_CHARS = 600;
const MIN_VERIFICATION_TEXT_CHARS = 20;

const VERIFIED_HEADING =
  /^ {0,3}(#{2,4})[ \t]+verified[ \t]*:?[ \t]*#*[ \t]*$/i;
const ANY_HEADING = /^ {0,3}(#{1,6})[ \t]+\S/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const SCREENSHOTS_END = /<!--\s*FUSION_SCREENSHOTS_END\s*-->/;

const MEDIA = [
  /<(?:img|video)\b/i,
  /!\[[^\]\n]{0,300}\]\([^)\s]+/,
  /https?:\/\/\S+\.(?:mp4|webm|mov|m4v)\b/i,
  /https?:\/\/(?:www\.)?builder\.io\/app\/timelines\//i,
  /https?:\/\/(?:www\.)?loom\.com\/share\//i,
  /https?:\/\/github\.com\/user-attachments\/assets\//i,
];

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  nbsp: " ",
};

function decodeEntity(
  _entity: string,
  code: string | undefined,
  name: string | undefined,
): string {
  if (name !== undefined) return NAMED_ENTITIES[name] ?? " ";
  const point = Number(code);
  return point < 32 || (point >= 0xd800 && point <= 0xdfff)
    ? " "
    : String.fromCodePoint(point);
}

function closesFence(line: string, fence: string): boolean {
  const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
  return (
    closing !== undefined &&
    closing[0] === fence[0] &&
    closing.length >= fence.length
  );
}

/** The lines under each `### Verified` heading, outside code fences, in order. */
function verifiedSections(body: string): string[][] {
  const sections: string[][] = [];
  let open: { level: number; lines: string[] } | null = null;
  let fence: string | null = null;

  for (const line of body.split(/\r\n|\n|\r/)) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      open?.lines.push(line);
      continue;
    }
    const opening = FENCE_OPEN.exec(line)?.[1];

    if (open) {
      const marker = SCREENSHOTS_END.exec(line);
      const heading = ANY_HEADING.exec(line)?.[1];
      if (marker) {
        open.lines.push(line.slice(0, marker.index));
        open = null;
        continue;
      }
      if (heading && heading.length <= open.level) open = null;
      else if (THEMATIC_BREAK.test(line)) open = null;
      else {
        if (opening) fence = opening;
        open.lines.push(line);
        continue;
      }
    }

    const verified = VERIFIED_HEADING.exec(line)?.[1];
    if (verified) {
      open = { level: verified.length, lines: [] };
      sections.push(open.lines);
    } else if (opening) {
      fence = opening;
    }
  }
  return sections;
}

function readableText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]{0,2000}?-->/g, " ")
    .replace(/<\/?[a-zA-Z][^>]{0,1000}>/g, " ")
    .replace(/!?\[([^\]\n]{0,300})\]\([^)\n]{0,2000}\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^[ \t|:-]+$/gm, " ")
    .replace(/&(?:#(\d{1,5})|(quot|amp|nbsp));/g, decodeEntity)
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string): string {
  return text.length > VERIFICATION_EXCERPT_CHARS
    ? `${text.slice(0, VERIFICATION_EXCERPT_CHARS - 1).trimEnd()}…`
    : text;
}

const absent = (): PullRequestVerification => ({
  present: false,
  hasMedia: false,
  excerpt: "",
});

/**
 * Reads the Verified section of a pull request description. A missing or empty
 * body is absent, not an error: whether the body could be read at all is the
 * caller's read, which fails on its own.
 */
export function summarizeVerification(
  body: string | null | undefined,
): PullRequestVerification {
  if (!body) return absent();
  let first: PullRequestVerification | null = null;
  for (const lines of verifiedSections(body)) {
    const section = lines.join("\n");
    const text = readableText(section);
    const hasMedia = MEDIA.some((pattern) => pattern.test(section));
    const found = {
      present: hasMedia || text.length >= MIN_VERIFICATION_TEXT_CHARS,
      hasMedia,
      excerpt: clip(text),
    };
    if (found.present) return found;
    first ??= found;
  }
  return first ?? absent();
}
