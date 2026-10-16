// The editor bridges bundle this module into every screen, so it stays
// dependency-free.

export const TEXT_LAYER_TAGS = new Set([
  "a",
  "button",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "label",
  "li",
  "p",
  "span",
  "strong",
]);

export const INLINE_TEXT_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "dfn",
  "em",
  "i",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);

export const EMPTY_STYLE_LENGTH = /^(0|0px|0rem|auto|initial|inherit|unset)$/i;
const EMPTY_STYLE_PAINT = /^(none|transparent|initial|inherit|unset|0|0px)$/i;

export type StyleValueReader = (property: string) => string | undefined;

export function bareClassToken(token: string): string {
  return token.slice(token.lastIndexOf(":") + 1).replace(/^-/, "");
}

export function styleValueIsPresent(
  value: string | undefined,
  empties: RegExp,
): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !empties.test(trimmed);
}

function classPaints(token: string): boolean {
  const bare = bareClassToken(token);
  if (/^bg-/.test(bare)) {
    return !/^bg-(transparent|none|inherit|current|clip-|origin-|fixed|local|scroll|bottom|center|left|right|top|repeat|no-repeat|auto|cover|contain|blend-)/.test(
      bare,
    );
  }
  if (/^border(-[xytrbles])?(-\d+)?$/.test(bare)) return !/-0$/.test(bare);
  if (/^ring(-\d+)?$/.test(bare)) return bare !== "ring-0";
  if (/^outline(-\d+)?$/.test(bare)) return bare !== "outline-0";
  if (/^shadow(-(sm|md|lg|xl|2xl|inner))?$/.test(bare)) return true;
  return false;
}

function classPads(token: string): boolean {
  const match = /^(p|px|py|pt|pr|pb|pl|ps|pe)-(.+)$/.exec(
    bareClassToken(token),
  );
  return Boolean(match) && match![2] !== "0";
}

export function paintsBox(
  classes: readonly string[],
  style: StyleValueReader,
): boolean {
  return (
    classes.some(classPaints) ||
    [
      "background",
      "background-color",
      "background-image",
      "border",
      "border-width",
      "box-shadow",
      "outline",
    ].some((property) =>
      styleValueIsPresent(style(property), EMPTY_STYLE_PAINT),
    )
  );
}

export function padsBox(
  classes: readonly string[],
  style: StyleValueReader,
): boolean {
  return (
    classes.some(classPads) ||
    [
      "padding",
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
    ].some((property) =>
      styleValueIsPresent(style(property), EMPTY_STYLE_LENGTH),
    )
  );
}
