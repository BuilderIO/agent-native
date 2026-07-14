import type { ReviewResourceContext } from "./types.js";

export function reviewAuthorNameFromContext(
  ctx: ReviewResourceContext | undefined,
): string | null {
  const value = ctx?.userName;
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) return null;
  return name;
}
