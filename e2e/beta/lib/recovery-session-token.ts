type TokenSelection =
  | { kind: "selected"; token: string }
  | {
      kind: "unavailable";
      code:
        | "invalid_app"
        | "token_map_unreadable"
        | "app_token_missing"
        | "app_token_ambiguous";
    };

export function selectRecoverySessionToken(
  app: unknown,
  tokens: unknown,
  resolvedToken: unknown,
  allowWildcard: boolean,
): TokenSelection {
  if (app !== "content" && app !== "dispatch") {
    return { kind: "unavailable", code: "invalid_app" };
  }
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    return { kind: "unavailable", code: "token_map_unreadable" };
  }
  const map = tokens as Record<string, unknown>;
  const key = Object.prototype.hasOwnProperty.call(map, app)
    ? app
    : allowWildcard === true && Object.prototype.hasOwnProperty.call(map, "*")
      ? "*"
      : null;
  const selected = key === null ? undefined : map[key];
  if (typeof selected !== "string" || !selected.trim()) {
    return { kind: "unavailable", code: "app_token_missing" };
  }
  if (resolvedToken !== selected.trim()) {
    return { kind: "unavailable", code: "app_token_ambiguous" };
  }
  return { kind: "selected", token: selected.trim() };
}
