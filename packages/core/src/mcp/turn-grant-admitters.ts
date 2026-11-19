import type { ActionUserTurn } from "../action.js";
import type { MCPCallerIdentity } from "./build-server.js";

/**
 * MCP turn grant admitters: deployment-owned admission for turn grants the
 * framework's own store does not recognize, such as a grant another
 * deployment-owned service minted for the user's current turn.
 *
 * An admitter is asked only after the framework has looked the presented
 * grant up and found nothing, and only for an action that declares
 * `userTurn`, from a device-connected user caller outside an agent run. An admitted grant runs the
 * call exactly like a framework grant: as the user's turn until `expiresAt`,
 * and only for the owner and app the decision names.
 * With no admitter registered the MCP action path behaves exactly as without
 * this module.
 */

/** A turn grant presented with one MCP action call. */
export interface McpTurnGrantPresentation {
  /** The raw grant the caller presented (the turn-grant header value). */
  grant: string;
  appId: string;
  actionName: string;
  userTurn: ActionUserTurn;
  identity: MCPCallerIdentity | undefined;
}

export type McpTurnGrantAdmitterDecision =
  | {
      status: "admitted";
      expiresAt: number;
      /** The user the grant was issued to; must be the calling user. */
      ownerEmail: string;
      /** The app the grant was issued for; must be this app. */
      appId: string;
    }
  | { status: "refused"; reason: string };

export interface McpTurnGrantAdmitter {
  /** Stable id; registering a different admitter under the same id throws. */
  id: string;
  /**
   * Admit or refuse a grant this admitter recognizes. Return undefined for a
   * grant it does not own, so the next admitter is asked. A throw refuses the
   * grant as `admitter-failed`, and no answer within
   * `MCP_TURN_GRANT_ADMITTER_TIMEOUT_MS` as `admitter-timeout`.
   */
  admit(
    presentation: McpTurnGrantPresentation,
  ):
    | McpTurnGrantAdmitterDecision
    | undefined
    | Promise<McpTurnGrantAdmitterDecision | undefined>;
}

interface McpTurnGrantAdmitterRegistry {
  admitters: McpTurnGrantAdmitter[];
}

const globals = globalThis as typeof globalThis & {
  __agentNativeMcpTurnGrantAdmitters?: McpTurnGrantAdmitterRegistry;
};
const registry: McpTurnGrantAdmitterRegistry =
  (globals.__agentNativeMcpTurnGrantAdmitters ??= { admitters: [] });

/**
 * Register an MCP turn grant admitter. Admitters are asked in registration
 * order and the first that returns a decision owns the grant. Registering the
 * same admitter object again is a no-op. Returns a function that removes it.
 */
export function registerMcpTurnGrantAdmitter(
  admitter: McpTurnGrantAdmitter,
): () => void {
  if (!admitter.id) throw new Error("An MCP turn grant admitter needs an id.");
  const existing = registry.admitters.find((entry) => entry.id === admitter.id);
  if (existing && existing !== admitter) {
    throw new Error(
      `MCP turn grant admitter "${admitter.id}" is already registered by another module.`,
    );
  }
  if (!existing) registry.admitters.push(admitter);
  return () => {
    const index = registry.admitters.indexOf(admitter);
    if (index >= 0) registry.admitters.splice(index, 1);
  };
}

export function listMcpTurnGrantAdmitters(): readonly McpTurnGrantAdmitter[] {
  return [...registry.admitters];
}

export function clearMcpTurnGrantAdmittersForTests(): void {
  registry.admitters.length = 0;
}

/**
 * Ask the registered admitters about a grant the framework did not recognize.
 * Undefined when none claims it.
 */
/** How long one admitter may take before its grant is refused. */
export const MCP_TURN_GRANT_ADMITTER_TIMEOUT_MS = 5_000;

const ADMITTER_TIMED_OUT = Symbol("admitter-timed-out");

export async function admitWithMcpTurnGrantAdmitters(
  presentation: McpTurnGrantPresentation,
): Promise<McpTurnGrantAdmitterDecision | undefined> {
  for (const admitter of listMcpTurnGrantAdmitters()) {
    let decision: McpTurnGrantAdmitterDecision | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const settled = await Promise.race([
        Promise.resolve(admitter.admit(presentation)),
        new Promise<typeof ADMITTER_TIMED_OUT>((resolve) => {
          timer = setTimeout(
            () => resolve(ADMITTER_TIMED_OUT),
            MCP_TURN_GRANT_ADMITTER_TIMEOUT_MS,
          );
        }),
      ]);
      if (settled === ADMITTER_TIMED_OUT) {
        console.error(`[mcp-turn-grant] admitter "${admitter.id}" timed out`);
        return { status: "refused", reason: "admitter-timeout" };
      }
      decision = settled;
    } catch (error) {
      console.error(`[mcp-turn-grant] admitter "${admitter.id}" failed`, error);
      return { status: "refused", reason: "admitter-failed" };
    } finally {
      clearTimeout(timer);
    }
    if (decision === undefined) continue;
    if (decision.status === "refused") return decision;
    // Admitters are deployment code that may not be type-checked against this union.
    const status: string = decision.status;
    if (
      status !== "admitted" ||
      !Number.isSafeInteger(decision.expiresAt) ||
      typeof decision.ownerEmail !== "string" ||
      typeof decision.appId !== "string"
    ) {
      console.error(
        `[mcp-turn-grant] admitter "${admitter.id}" returned an invalid decision`,
      );
      return { status: "refused", reason: "admitter-failed" };
    }
    const caller = presentation.identity?.userEmail?.trim().toLowerCase();
    if (!caller || decision.ownerEmail.trim().toLowerCase() !== caller)
      return { status: "refused", reason: "owner-mismatch" };
    if (decision.appId !== presentation.appId)
      return { status: "refused", reason: "app-mismatch" };
    if (decision.expiresAt <= Date.now())
      return { status: "refused", reason: "expired" };
    return decision;
  }
  return undefined;
}
