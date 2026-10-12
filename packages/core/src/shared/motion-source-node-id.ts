/** Stable ID for a host JSX element within its project-relative source module. */
export function generatedMotionNodeId(
  modulePath: string,
  hostElementOrdinal: number,
): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < modulePath.length; index += 1) {
    hash ^= BigInt(modulePath.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `an-${hash.toString(16).padStart(16, "0")}-${hostElementOrdinal}`;
}

export function isMotionSourceHostElementTag(tagName: string): boolean {
  return /^[a-z]/.test(tagName) && tagName !== "script" && tagName !== "style";
}
