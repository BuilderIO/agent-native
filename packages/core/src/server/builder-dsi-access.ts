import { ActionContractError } from "../action.js";
import type {
  BuilderDsiAccess,
  BuilderDsiScope,
} from "../shared/builder-dsi-access.js";
import { resolvePersonalBuilderAccountAccess } from "./builder-oauth.js";
import { getRequestContext } from "./request-context.js";

export type {
  BuilderDsiAccess,
  BuilderDsiScope,
} from "../shared/builder-dsi-access.js";

const DSI_SCOPES = [
  "builder:designsystem:read",
  "builder:designsystem:write",
] as const satisfies readonly BuilderDsiScope[];

async function resolveAccess(refresh: boolean): Promise<BuilderDsiAccess> {
  const context = getRequestContext();
  const email = context?.userEmail?.trim();
  if (!email || context?.authCapability) {
    return { status: "unauthenticated", eligible: false };
  }
  const access = await resolvePersonalBuilderAccountAccess({
    ownerEmail: email,
    orgId: context?.orgId ?? null,
    requiredScopes: DSI_SCOPES,
    refresh,
  });
  switch (access.status) {
    case "missing":
      return { ...access, eligible: false };
    case "unavailable":
      return { ...access, eligible: null };
    default:
      return { ...access, eligible: true };
  }
}

/**
 * Inspect personal account eligibility without refreshing or creating a link.
 * Requires authenticated request context; ambient CLI identity never qualifies.
 * Ready includes a refreshable grant, not a promise of upstream availability.
 */
export function getBuilderDsiAccess(): Promise<BuilderDsiAccess> {
  return resolveAccess(false);
}

export type BuilderDsiAccessDenied = Exclude<
  BuilderDsiAccess,
  { status: "ready" }
>;

export class BuilderDsiAccessError extends ActionContractError {
  readonly access: BuilderDsiAccessDenied;

  constructor(access: BuilderDsiAccessDenied) {
    const failure = {
      unauthenticated: {
        message: "Sign in to Agent-Native to use Builder DSI.",
        statusCode: 401,
      },
      missing: {
        message: "Connect your own Builder account to use DSI.",
        statusCode: 403,
      },
      reconnect_required: {
        message: "Reconnect your Builder account to use DSI.",
        statusCode: 409,
      },
      unavailable: {
        message: "Builder account access could not be verified. Try again.",
        statusCode: 503,
      },
    }[access.status];
    super(failure.message, {
      errorCode: `builder_dsi_${access.status}`,
      statusCode: failure.statusCode,
      details: { access },
    });
    this.name = "BuilderDsiAccessError";
    this.access = access;
  }
}

/** Re-read proof and perform canonical token refresh before allowing execution. */
export async function assertBuilderDsiAccess(): Promise<
  Extract<BuilderDsiAccess, { status: "ready" }>
> {
  const access = await resolveAccess(true);
  if (access.status !== "ready") throw new BuilderDsiAccessError(access);
  return access;
}
