import {
  resourceListContentByOwnersAndPrefixes,
  resourcePut,
  sharedResourceOwner,
} from "@agent-native/core/resources/store";

export const POINTER_PREFIX = "pointers/";

export type Pointer = {
  alias: string;
  appId: string;
  objectId?: string;
  url?: string;
  scope: "user" | "org";
};

/** Lowercase, drop punctuation and a leading "my", singularize each word. */
export function normalizeAlias(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/['’]s\b/g, "s")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words[0] === "my" || words[0] === "the") words.shift();
  return words.map((word) =>
    word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
      ? word.slice(0, -1)
      : word,
  );
}

export function pointerPath(alias: string): string {
  return `${POINTER_PREFIX}${normalizeAlias(alias).join("-")}.json`;
}

export async function rememberPointer(input: {
  owner: string;
  orgId?: string | null | undefined;
  scope: "user" | "org";
  alias: string;
  appId: string;
  objectId?: string | undefined;
  url?: string | undefined;
}): Promise<{ path: string; alias: string }> {
  const alias = normalizeAlias(input.alias).join(" ");
  if (!alias) throw new Error("alias is required");
  const owner =
    input.scope === "org" ? sharedResourceOwner(input.orgId) : input.owner;
  const path = pointerPath(alias);
  await resourcePut(
    owner,
    path,
    JSON.stringify({
      alias,
      appId: input.appId,
      ...(input.objectId ? { objectId: input.objectId } : {}),
      ...(input.url ? { url: input.url } : {}),
      updatedAt: new Date().toISOString(),
    }),
    "application/json",
    input.orgId ? { orgId: input.orgId } : undefined,
  );
  return { path, alias };
}

/** One indexed query covers the user's pointers and the organization's. */
export async function listPointers(
  owner: string,
  orgId?: string | null,
): Promise<Pointer[]> {
  const orgOwner = orgId ? sharedResourceOwner(orgId) : null;
  const rows = await resourceListContentByOwnersAndPrefixes(
    orgOwner ? [owner, orgOwner] : [owner],
    [POINTER_PREFIX],
    orgId ? { orgId } : {},
  );
  const pointers: Pointer[] = [];
  for (const row of rows) {
    try {
      const value = JSON.parse(row.content) as Record<string, unknown>;
      if (typeof value.alias !== "string" || typeof value.appId !== "string")
        continue;
      pointers.push({
        alias: value.alias,
        appId: value.appId,
        ...(typeof value.objectId === "string"
          ? { objectId: value.objectId }
          : {}),
        ...(typeof value.url === "string" ? { url: value.url } : {}),
        scope: row.owner === owner ? "user" : "org",
      });
    } catch (error) {
      console.warn("[pointers] skipped malformed pointer", row.path, error);
    }
  }
  return pointers;
}

/**
 * Deterministic alias match: every word of the alias appears in the request
 * (after normalization). The longest alias wins; a personal pointer beats an
 * organization pointer for the same alias.
 */
export function matchPointer(
  text: string,
  pointers: readonly Pointer[],
): Pointer | null {
  const words = new Set(normalizeAlias(text));
  const textWords = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const word of textWords) words.add(word);
  let best: Pointer | null = null;
  let bestLength = 0;
  for (const pointer of pointers) {
    const aliasWords = normalizeAlias(pointer.alias);
    if (aliasWords.length === 0) continue;
    if (!aliasWords.every((word) => words.has(word))) continue;
    const length = aliasWords.join(" ").length;
    if (
      length > bestLength ||
      (length === bestLength &&
        best?.scope === "org" &&
        pointer.scope === "user")
    ) {
      best = pointer;
      bestLength = length;
    }
  }
  return best;
}
