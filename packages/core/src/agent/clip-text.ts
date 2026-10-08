// Provider APIs reject a request whose JSON holds half a surrogate pair, so a
// clip that lands inside an emoji must drop the half instead of keeping it.
const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** At most the first `max` UTF-16 units of `text`, never ending inside a surrogate pair. */
export function clipHead(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(
    0,
    isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max,
  );
}

/** At most the last `max` UTF-16 units of `text`, never starting inside a surrogate pair. */
export function clipTail(text: string, max: number): string {
  if (text.length <= max) return text;
  const start = text.length - max;
  return text.slice(isLowSurrogate(text.charCodeAt(start)) ? start + 1 : start);
}
