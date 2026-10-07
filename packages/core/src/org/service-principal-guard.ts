import { parseServiceIdentityEmail } from "./service-identity.js";
/**
 * Enforcement helpers over the service-principal policy store. MCP admission,
 * MCP tool dispatch, and inbound A2A all ask these instead of reading
 * `evaluateServicePrincipal` themselves, so a refusal means the same thing
 * (status, message, audit row) on every entry point.
 */
import {
  evaluateServicePrincipal,
  isActionGranted,
  SERVICE_PRINCIPAL_SUSPENDED_MESSAGE,
} from "./service-principal-policy.js";

export const SERVICE_PRINCIPAL_UNAVAILABLE_MESSAGE =
  "The service principal's status could not be verified. Retry shortly.";

export type ServicePrincipalRefusalCode =
  | "service_principal_inactive"
  | "service_principal_unavailable"
  | "service_principal_action_denied"
  | "service_principal_handoff_unsupported";

/** 403 is a refusal (audited as `denied`); 503 is retryable and never a denial. */
export class ServicePrincipalRefusedError extends Error {
  readonly errorCode: ServicePrincipalRefusalCode;
  readonly statusCode: 403 | 503;

  constructor(code: ServicePrincipalRefusalCode, message: string) {
    super(message);
    this.name = "ServicePrincipalRefusedError";
    this.errorCode = code;
    this.statusCode = code === "service_principal_unavailable" ? 503 : 403;
  }
}

export function servicePrincipalActionDeniedError(
  actionName: string,
): ServicePrincipalRefusedError {
  return new ServicePrincipalRefusedError(
    "service_principal_action_denied",
    `Forbidden: ${actionName} is not permitted for this service principal.`,
  );
}

/**
 * Throws `ServicePrincipalRefusedError` when `email` is a service identity that
 * is suspended or retired, or whose policy could not be read. Otherwise returns
 * its action grant: `null` is unrestricted (not a service identity, or a legacy
 * principal with no policy row), a list is the only set of actions it may call.
 * Non-service callers return without touching the database.
 */
export async function assertServicePrincipalMayRun(
  email: string | null | undefined,
  orgId?: string | null,
): Promise<{ allowedActions: string[] | null }> {
  const state = await evaluateServicePrincipal(email, orgId);
  switch (state.status) {
    case "not-service":
    case "ungoverned":
      return { allowedActions: null };
    case "active":
      return { allowedActions: state.policy.allowedActions };
    case "suspended":
    case "retired":
    case "org-mismatch":
      throw new ServicePrincipalRefusedError(
        "service_principal_inactive",
        SERVICE_PRINCIPAL_SUSPENDED_MESSAGE,
      );
    case "unavailable":
      throw new ServicePrincipalRefusedError(
        "service_principal_unavailable",
        SERVICE_PRINCIPAL_UNAVAILABLE_MESSAGE,
      );
  }
}

/** Throws a 403 refusal unless the grant covers `actionName`. */
export function assertServicePrincipalMayCall(
  allowedActions: string[] | null,
  actionName: string,
): void {
  if (!isActionGranted(allowedActions, actionName)) {
    throw servicePrincipalActionDeniedError(actionName);
  }
}

/**
 * Writes a `denied` audit row for a refused service-principal call. Visible to
 * org admins only; the recorder is best-effort and never throws.
 */
export async function recordServicePrincipalDenial(input: {
  email: string | null | undefined;
  orgId?: string | null;
  actionName: string;
  caller: string;
  error: ServicePrincipalRefusedError;
}): Promise<void> {
  if (input.error.statusCode !== 403) return;
  const { recordActionAudit } = await import("../audit/record.js");
  const orgId =
    input.orgId ?? parseServiceIdentityEmail(input.email)?.orgId ?? null;
  await recordActionAudit({
    config: {
      enabled: true,
      target: () => ({
        type: "service-principal",
        id: input.email ?? undefined,
        orgId,
        visibility: "admins",
      }),
      summary: () =>
        input.error.errorCode === "service_principal_inactive"
          ? `Refused ${input.actionName}: service principal is suspended or retired`
          : input.error.errorCode === "service_principal_action_denied"
            ? `Refused ${input.actionName}: not in the service principal's allowed actions`
            : `Refused ${input.actionName}: service principal authorization cannot be preserved across the handoff`,
    },
    args: {},
    ctx: {
      actionName: input.actionName,
      caller: input.caller,
      userEmail: input.email ?? undefined,
      orgId,
    },
    status: "error",
    error: input.error,
  });
}

/**
 * The action-execution check: refuse a service identity's call to `actionName`
 * when it is suspended, unverifiable, or outside its grant, and record one
 * `denied` row for a 403. Evaluated on every call, never cached, so a suspend
 * or re-scope takes effect on the next action of a run already in flight.
 * Non-service callers return without touching the database.
 */
export async function enforceServicePrincipalActionGrant(input: {
  email: string | null | undefined;
  orgId?: string | null;
  actionName: string;
  caller: string;
}): Promise<void> {
  try {
    const { allowedActions } = await assertServicePrincipalMayRun(
      input.email,
      input.orgId,
    );
    assertServicePrincipalMayCall(allowedActions, input.actionName);
  } catch (error) {
    if (error instanceof ServicePrincipalRefusedError) {
      await recordServicePrincipalDenial({ ...input, error });
    }
    throw error;
  }
}
