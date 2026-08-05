import {
  describeBrandKitTokenRejections,
  normalizeBrandKitTokens,
} from "@agent-native/core/brand-kit/tokens";

/**
 * Reject a write whose named tokens cannot be stored verbatim. Keeping the
 * storable subset would read downstream as a genuinely smaller design system.
 */
export function assertStorableDesignSystemTokens(dataJson: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataJson);
  } catch {
    throw new Error("data must be a valid JSON object string");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("data must be a valid JSON object string");
  }

  const tokens = (parsed as Record<string, unknown>).tokens;
  if (tokens === undefined) return;

  const { rejected } = normalizeBrandKitTokens(tokens);
  if (rejected.length > 0) {
    throw new Error(
      `data.tokens contains ${rejected.length} entr${
        rejected.length === 1 ? "y" : "ies"
      } that cannot be stored: ${describeBrandKitTokenRejections(rejected)}. ` +
        "Each token needs a name, a CSS custom property (-- followed by " +
        "letters, digits, hyphens or underscores), and a value with no " +
        '";", "{", "}", "<", ">", or CSS comment.',
    );
  }
}
