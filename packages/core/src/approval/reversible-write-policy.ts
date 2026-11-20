import type { ActionRunContext } from "../action.js";

const NO_APPROVALS_SETTING_KEY = "no-approvals";

/**
 * Marks a `needsApproval` predicate as a reversible-write policy whose MCP
 * approval asks inline in a client-showable form and never emits a review-page
 * link.
 */
export const REVERSIBLE_WRITE_INLINE_APPROVAL_KEY = Symbol.for(
  "agent-native.approval.reversibleWriteInlineForm",
);

/**
 * Whether reversible writes run without an approval prompt for `email`:
 * - Unset setting (default): `true` (reversible writes do not hold).
 * - Explicitly `{ enabled: true }`: `true`.
 * - Explicitly `{ enabled: false }` (user turned approvals ON): `false`.
 * - Missing email or unreadable setting: `false` (fails closed).
 */
export async function isReversibleWriteNoApprovalsMode(
  email: string | undefined,
): Promise<boolean> {
  if (!email) return false;
  try {
    const { getUserSetting } = await import("../settings/index.js");
    const stored = await getUserSetting(email, NO_APPROVALS_SETTING_KEY);
    if (stored == null) return true;
    if (typeof stored.enabled === "boolean") return stored.enabled;
    return false;
  } catch {
    // coercion-ok: an unreadable setting fails closed and leaves approval on.
    return false;
  }
}

export type ReversibleWriteApprovalPredicate<TArgs = unknown> = ((
  args: TArgs,
  ctx?: Pick<ActionRunContext, "userEmail">,
) => Promise<boolean>) & {
  readonly [REVERSIBLE_WRITE_INLINE_APPROVAL_KEY]: true;
};

/**
 * Shared `needsApproval` predicate for reversible writes:
 * - Runs immediately at the default setting (when `no-approvals` is unset or `{ enabled: true }`).
 * - Asks when the user explicitly turned approvals ON (`{ enabled: false }`), or when
 *   email is absent / the setting cannot be read.
 * - Marked so MCP asks inline in a form prompt, never via a review-page link.
 */
export const reversibleWriteNeedsApproval: ReversibleWriteApprovalPredicate =
  Object.assign(
    async (
      _args: unknown,
      ctx?: Pick<ActionRunContext, "userEmail">,
    ): Promise<boolean> =>
      !(await isReversibleWriteNoApprovalsMode(ctx?.userEmail)),
    { [REVERSIBLE_WRITE_INLINE_APPROVAL_KEY]: true as const },
  );

/**
 * Builds a reversible-write `needsApproval` predicate with an optional
 * per-call condition evaluated when approvals are explicitly turned on.
 */
export function createReversibleWriteApprovalPolicy<TArgs = unknown>(
  shouldAskWhenApprovalsOn?: (
    args: TArgs,
    ctx?: Pick<ActionRunContext, "userEmail">,
  ) => boolean | Promise<boolean>,
): ReversibleWriteApprovalPredicate<TArgs> {
  return Object.assign(
    async (
      args: TArgs,
      ctx?: Pick<ActionRunContext, "userEmail">,
    ): Promise<boolean> => {
      if (await isReversibleWriteNoApprovalsMode(ctx?.userEmail)) return false;
      if (!shouldAskWhenApprovalsOn) return true;
      return Boolean(await shouldAskWhenApprovalsOn(args, ctx));
    },
    { [REVERSIBLE_WRITE_INLINE_APPROVAL_KEY]: true as const },
  );
}

/**
 * Whether an action's `needsApproval` predicate uses the reversible-write
 * inline MCP form policy instead of a review-page link.
 */
export function isReversibleWriteInlineApprovalAction(
  entry:
    | {
        needsApproval?: unknown;
        userTurn?: unknown;
        requiresUserTurn?: unknown;
      }
    | undefined,
): boolean {
  if (
    !entry ||
    entry.requiresUserTurn === true ||
    entry.userTurn === "approval"
  ) {
    return false;
  }
  const gate = entry.needsApproval;
  return (
    typeof gate === "function" &&
    (gate as unknown as Record<symbol, unknown>)[
      REVERSIBLE_WRITE_INLINE_APPROVAL_KEY
    ] === true
  );
}
