import crypto from "node:crypto";

import { fail, type ActionRunContext } from "@agent-native/core/action";
import { verifyShortLivedToken } from "@agent-native/core/server";
import { and, eq, gt, isNull, lt } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  requireLocalhostBridgeToken,
  resolveLocalhostBridgeConnection,
  resolveLocalhostConnectionScope,
} from "../server/lib/localhost-connection.js";
import {
  LOCALHOST_BRIDGE_RELAY_MARKER,
  LOCALHOST_BRIDGE_RELAY_CHAIN_HEADER,
  localhostBridgeRelayChallengeResourceId,
  type LocalhostBridgeRelay,
  type LocalhostBridgeRelayResponse,
  type MotionLocalhostRelayAction,
} from "../shared/visual-edit-bridge-relay.js";

const RELAY_STEP_CONTEXT_KEY = "__agentNativeLocalhostBridgeStep";
const RELAY_RESPONSES_CONTEXT_KEY = "__agentNativeLocalhostBridgeResponses";
const RELAY_IDENTITY_CONTEXT_KEY = "__agentNativeLocalhostBridgeIdentity";
const RELAY_VALIDATED_CONTEXT_KEY = "__agentNativeLocalhostBridgeValidated";

export interface MotionLocalhostRelayIdentity {
  chainId: string;
  actionName: MotionLocalhostRelayAction;
  inputHash: string;
}

type RelayActionContext = ActionRunContext & {
  [RELAY_STEP_CONTEXT_KEY]?: string;
  [RELAY_RESPONSES_CONTEXT_KEY]?: unknown;
  [RELAY_IDENTITY_CONTEXT_KEY]?: MotionLocalhostRelayIdentity;
  [RELAY_VALIDATED_CONTEXT_KEY]?: Set<string>;
};

interface RunnableAction<TArgs, TResult> {
  run: (args: TArgs, context?: ActionRunContext) => TResult | Promise<TResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isLocalhostBridgeRelay(
  value: unknown,
): value is LocalhostBridgeRelay {
  return (
    isRecord(value) &&
    value.__agentNativeLocalhostBridge === LOCALHOST_BRIDGE_RELAY_MARKER &&
    (value.operation === "read-file" ||
      value.operation === "list-files" ||
      value.operation === "write-file" ||
      value.operation === "apply-edit" ||
      value.operation === "verify-module-provenance") &&
    typeof value.designId === "string" &&
    typeof value.connectionId === "string"
  );
}

export function localhostBridgeRelayContextWithResponses(
  context: ActionRunContext,
  responses: LocalhostBridgeRelayResponse[],
  identity?: MotionLocalhostRelayIdentity,
): ActionRunContext {
  return {
    ...context,
    [RELAY_RESPONSES_CONTEXT_KEY]: responses,
    ...(identity ? { [RELAY_IDENTITY_CONTEXT_KEY]: identity } : {}),
    [RELAY_VALIDATED_CONTEXT_KEY]: new Set<string>(),
  } as RelayActionContext;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function withMotionLocalhostRelayIdentity(
  context: ActionRunContext | undefined,
  actionName: MotionLocalhostRelayAction,
  input: unknown,
): ActionRunContext | undefined {
  if (!context) return context;
  const chainId = context.requestHeaders
    ?.get(LOCALHOST_BRIDGE_RELAY_CHAIN_HEADER)
    ?.trim();
  if (!chainId) return context;
  if (!/^[a-f0-9-]{32,64}$/i.test(chainId)) {
    return fail("The Motion localhost relay chain identity is malformed.", {
      errorCode: "localhost_bridge_relay_chain_invalid",
      statusCode: 400,
    });
  }
  if (context.actionName && context.actionName !== actionName) {
    return fail("The Motion relay action does not match this request.", {
      errorCode: "localhost_bridge_relay_action_mismatch",
      statusCode: 409,
    });
  }
  const inputHash = crypto
    .createHash("sha256")
    .update(stableJson(input))
    .digest("hex");
  const prior = context as RelayActionContext;
  const priorIdentity = prior[RELAY_IDENTITY_CONTEXT_KEY];
  const validated =
    priorIdentity?.chainId === chainId &&
    priorIdentity.actionName === actionName &&
    priorIdentity.inputHash === inputHash
      ? prior[RELAY_VALIDATED_CONTEXT_KEY]
      : undefined;
  return {
    ...context,
    [RELAY_IDENTITY_CONTEXT_KEY]: { chainId, actionName, inputHash },
    [RELAY_VALIDATED_CONTEXT_KEY]: validated ?? new Set<string>(),
  } as RelayActionContext;
}

export function motionLocalhostRelayIdentity(
  context: ActionRunContext | undefined,
): MotionLocalhostRelayIdentity | undefined {
  return (context as RelayActionContext | undefined)?.[
    RELAY_IDENTITY_CONTEXT_KEY
  ];
}

export async function ensureMotionLocalhostRelayChain(
  identity: MotionLocalhostRelayIdentity,
): Promise<boolean> {
  const db = getDb();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(now + 120_000).toISOString();
  await db
    .delete(schema.designMotionBridgeRelayChains)
    .where(lt(schema.designMotionBridgeRelayChains.expiresAt, nowIso));
  const [created] = await db
    .insert(schema.designMotionBridgeRelayChains)
    .values({
      chainId: identity.chainId,
      actionName: identity.actionName,
      inputHash: identity.inputHash,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning({ chainId: schema.designMotionBridgeRelayChains.chainId });
  if (created) return true;
  const [existing] = await db
    .select({
      actionName: schema.designMotionBridgeRelayChains.actionName,
      inputHash: schema.designMotionBridgeRelayChains.inputHash,
      expiresAt: schema.designMotionBridgeRelayChains.expiresAt,
      completedAt: schema.designMotionBridgeRelayChains.completedAt,
    })
    .from(schema.designMotionBridgeRelayChains)
    .where(eq(schema.designMotionBridgeRelayChains.chainId, identity.chainId))
    .limit(1);
  return Boolean(
    existing &&
    existing.actionName === identity.actionName &&
    existing.inputHash === identity.inputHash &&
    existing.expiresAt > nowIso &&
    existing.completedAt === null,
  );
}

export async function isActiveMotionLocalhostRelayChain(
  identity: MotionLocalhostRelayIdentity,
): Promise<boolean> {
  const now = new Date().toISOString();
  const [existing] = await getDb()
    .select({
      actionName: schema.designMotionBridgeRelayChains.actionName,
      inputHash: schema.designMotionBridgeRelayChains.inputHash,
      expiresAt: schema.designMotionBridgeRelayChains.expiresAt,
      completedAt: schema.designMotionBridgeRelayChains.completedAt,
    })
    .from(schema.designMotionBridgeRelayChains)
    .where(eq(schema.designMotionBridgeRelayChains.chainId, identity.chainId))
    .limit(1);
  return Boolean(
    existing &&
    existing.actionName === identity.actionName &&
    existing.inputHash === identity.inputHash &&
    existing.expiresAt > now &&
    existing.completedAt === null,
  );
}

export async function completeMotionLocalhostRelayChain(
  identity: MotionLocalhostRelayIdentity,
): Promise<boolean> {
  const now = new Date().toISOString();
  const [completed] = await getDb()
    .update(schema.designMotionBridgeRelayChains)
    .set({ completedAt: now })
    .where(
      and(
        eq(schema.designMotionBridgeRelayChains.chainId, identity.chainId),
        eq(
          schema.designMotionBridgeRelayChains.actionName,
          identity.actionName,
        ),
        eq(schema.designMotionBridgeRelayChains.inputHash, identity.inputHash),
        gt(schema.designMotionBridgeRelayChains.expiresAt, now),
        isNull(schema.designMotionBridgeRelayChains.completedAt),
      ),
    )
    .returning({ chainId: schema.designMotionBridgeRelayChains.chainId });
  return Boolean(completed);
}

export function allMotionLocalhostRelayResponsesValidated(
  context: ActionRunContext,
  responses: LocalhostBridgeRelayResponse[],
): boolean {
  const validated = (context as RelayActionContext)[
    RELAY_VALIDATED_CONTEXT_KEY
  ];
  const challenges = responses.map((response) => response.relay.challenge);
  return Boolean(
    validated &&
    challenges.every(
      (challenge) => typeof challenge === "string" && validated.has(challenge),
    ) &&
    new Set(challenges).size === challenges.length,
  );
}

export function markMotionLocalhostRelayResponseValidated(
  context: ActionRunContext | undefined,
  challenge: string,
): void {
  (context as RelayActionContext | undefined)?.[
    RELAY_VALIDATED_CONTEXT_KEY
  ]?.add(challenge);
}

export function localhostBridgeRelayStep(
  context: ActionRunContext | undefined,
): string | undefined {
  const step = (context as RelayActionContext | undefined)?.[
    RELAY_STEP_CONTEXT_KEY
  ];
  return typeof step === "string" ? step : undefined;
}

export async function runLocalhostBridgeStep<TArgs, TResult>(args: {
  action: RunnableAction<TArgs, TResult>;
  actionArgs: TArgs;
  context: ActionRunContext | undefined;
  step: string;
  beforeStep?: () => unknown | Promise<unknown>;
}): Promise<TResult | LocalhostBridgeRelay> {
  const context = args.context
    ? ({
        ...args.context,
        [RELAY_STEP_CONTEXT_KEY]: args.step,
      } as RelayActionContext)
    : undefined;
  const pendingResponses = (context as RelayActionContext | undefined)?.[
    RELAY_RESPONSES_CONTEXT_KEY
  ];
  const hasResponseForStep =
    Array.isArray(pendingResponses) &&
    pendingResponses.some(
      (entry) =>
        isRecord(entry) &&
        isLocalhostBridgeRelay(entry.relay) &&
        entry.relay.step === args.step,
    );
  if (!hasResponseForStep) await args.beforeStep?.();

  const result = context
    ? await args.action.run(args.actionArgs, context)
    : await args.action.run(args.actionArgs);

  if (!isLocalhostBridgeRelay(result)) return result as TResult;
  if (result.step !== args.step) {
    return fail(
      "The localhost bridge returned a source operation for an unexpected Motion step.",
      { errorCode: "localhost_bridge_relay_step_mismatch", statusCode: 502 },
    );
  }

  const responses = (context as RelayActionContext | undefined)?.[
    RELAY_RESPONSES_CONTEXT_KEY
  ];
  if (!Array.isArray(responses)) return result;

  const response = responses.find(
    (entry): entry is LocalhostBridgeRelayResponse =>
      isRecord(entry) &&
      isLocalhostBridgeRelay(entry.relay) &&
      entry.relay.step === args.step,
  );
  if (!response) return result;
  if (!sameRelayOperation(response.relay, result)) {
    return fail(
      "The localhost bridge response does not match the current Motion source operation.",
      { errorCode: "localhost_bridge_relay_mismatch", statusCode: 409 },
    );
  }

  if (!isValidBridgeResult(result, response.result)) {
    return fail(
      "The localhost bridge returned an incomplete Motion source result.",
      { errorCode: "localhost_bridge_relay_invalid_result", statusCode: 502 },
    );
  }
  if (!(await verifyLocalhostBridgeReceipt(response.relay, response.result))) {
    return fail(
      "The localhost bridge response is missing a valid, unused Motion receipt.",
      {
        errorCode: "localhost_bridge_relay_invalid_receipt",
        statusCode: 502,
      },
    );
  }
  if (response.relay.challenge) {
    markMotionLocalhostRelayResponseValidated(
      context,
      response.relay.challenge,
    );
  }
  return response.result as TResult;
}

function sameRelayOperation(
  left: LocalhostBridgeRelay,
  right: LocalhostBridgeRelay,
): boolean {
  return (
    left.operation === right.operation &&
    left.designId === right.designId &&
    left.connectionId === right.connectionId &&
    left.step === right.step &&
    left.chainId === right.chainId &&
    left.actionName === right.actionName &&
    left.inputHash === right.inputHash &&
    // The client carries the receipt challenge from the first action call;
    // the continuation's nested action creates a fresh challenge.
    left.path === right.path &&
    left.relPath === right.relPath &&
    JSON.stringify(left.payload ?? null) ===
      JSON.stringify(right.payload ?? null)
  );
}

const LOCALHOST_BRIDGE_RECEIPT_DOMAIN =
  "agent-native-design-motion-bridge-receipt-v1\0";

interface BridgeReceiptInput {
  challenge: string;
  operation:
    | "read-file"
    | "write-file"
    | "apply-edit"
    | "verify-module-provenance";
  relPath: string;
  routePath?: string;
  reachable?: boolean;
  expectedVersionHash?: unknown;
  requireExpectedVersionHash?: unknown;
  content?: unknown;
  search?: unknown;
  replace?: unknown;
  versionHash: string;
  resultContent?: unknown;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function bridgeReceiptSignature(
  bridgeToken: string,
  input: BridgeReceiptInput,
): string {
  const payloadHash =
    input.operation === "read-file" ||
    input.operation === "verify-module-provenance"
      ? ""
      : typeof input.content === "string"
        ? sha256(`content\0${input.content}`)
        : typeof input.search === "string" && typeof input.replace === "string"
          ? sha256(`patch\0${JSON.stringify([input.search, input.replace])}`)
          : "";
  const resultContentHash =
    input.operation === "read-file" && typeof input.resultContent === "string"
      ? sha256(input.resultContent)
      : "";
  return crypto
    .createHmac("sha256", bridgeToken)
    .update(LOCALHOST_BRIDGE_RECEIPT_DOMAIN)
    .update(
      JSON.stringify([
        input.challenge,
        input.operation,
        input.relPath,
        input.routePath ?? null,
        typeof input.reachable === "boolean" ? input.reachable : null,
        typeof input.expectedVersionHash === "string"
          ? input.expectedVersionHash
          : null,
        input.requireExpectedVersionHash === true,
        payloadHash,
        input.versionHash,
        resultContentHash,
      ]),
    )
    .digest("hex");
}

function relayReceiptInput(
  relay: LocalhostBridgeRelay,
  result: Record<string, unknown>,
): BridgeReceiptInput | null {
  if (!relay.challenge) return null;
  if (
    relay.operation !== "verify-module-provenance" &&
    typeof result.versionHash !== "string"
  ) {
    return null;
  }
  const payload = relay.payload ?? {};
  const patch =
    payload.patch &&
    typeof payload.patch === "object" &&
    !Array.isArray(payload.patch)
      ? (payload.patch as Record<string, unknown>)
      : {};
  const relPath = relay.operation === "read-file" ? relay.path : relay.relPath;
  if (!relPath) return null;
  return {
    challenge: relay.challenge,
    operation: relay.operation as BridgeReceiptInput["operation"],
    relPath,
    ...(relay.operation === "verify-module-provenance"
      ? {
          routePath: relay.path,
          reachable:
            typeof result.reachable === "boolean"
              ? result.reachable
              : undefined,
        }
      : {}),
    expectedVersionHash: payload.expectedVersionHash,
    requireExpectedVersionHash: payload.requireExpectedVersionHash,
    content: typeof payload.content === "string" ? payload.content : undefined,
    search: typeof patch.search === "string" ? patch.search : undefined,
    replace: typeof patch.replace === "string" ? patch.replace : undefined,
    versionHash:
      typeof result.versionHash === "string" ? result.versionHash : "",
    resultContent: relay.operation === "read-file" ? result.content : undefined,
  };
}

export async function verifyLocalhostBridgeReceipt(
  relay: LocalhostBridgeRelay,
  value: unknown,
): Promise<boolean> {
  if (
    !isRecord(value) ||
    typeof value.operationReceipt !== "string" ||
    !/^[a-f0-9]{64}$/i.test(value.operationReceipt) ||
    !relay.challenge
  ) {
    return false;
  }
  const claims = verifyShortLivedToken(
    relay.challenge,
    localhostBridgeRelayChallengeResourceId(relay),
  );
  const nonce = claims.ok ? claims.agentLabel : undefined;
  if (!nonce || !/^[a-f0-9]{64}$/i.test(nonce)) return false;

  const scope = await resolveLocalhostConnectionScope({
    designId: relay.designId,
  });
  const connection = await resolveLocalhostBridgeConnection({
    connectionId: relay.connectionId,
    ...scope,
  });
  const bridgeToken = requireLocalhostBridgeToken(
    relay.connectionId,
    connection.bridgeToken,
  );
  const input = relayReceiptInput(relay, value);
  if (!input) return false;
  const expected = bridgeReceiptSignature(bridgeToken, input);
  const supplied = Buffer.from(value.operationReceipt, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    supplied.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(supplied, expectedBuffer)
  ) {
    return false;
  }

  const db = getDb();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  await db
    .delete(schema.designMotionBridgeReceiptChallenges)
    .where(lt(schema.designMotionBridgeReceiptChallenges.expiresAt, nowIso));
  const chainIdentity =
    relay.chainId && relay.actionName && relay.inputHash
      ? {
          chainId: relay.chainId,
          actionName: relay.actionName,
          inputHash: relay.inputHash,
        }
      : undefined;
  if (
    (relay.chainId || relay.actionName || relay.inputHash) &&
    (!chainIdentity ||
      !(await isActiveMotionLocalhostRelayChain(chainIdentity)))
  ) {
    return false;
  }
  const receiptHash = sha256(stableJson(value));
  const [consumed] = await db
    .insert(schema.designMotionBridgeReceiptChallenges)
    .values({
      nonce,
      expiresAt: new Date(now + 120_000).toISOString(),
      ...(chainIdentity ? { chainId: chainIdentity.chainId, receiptHash } : {}),
    })
    .onConflictDoNothing()
    .returning({ nonce: schema.designMotionBridgeReceiptChallenges.nonce });
  if (consumed) return true;
  if (!chainIdentity) return false;
  const [prior] = await db
    .select({
      chainId: schema.designMotionBridgeReceiptChallenges.chainId,
      receiptHash: schema.designMotionBridgeReceiptChallenges.receiptHash,
      expiresAt: schema.designMotionBridgeReceiptChallenges.expiresAt,
    })
    .from(schema.designMotionBridgeReceiptChallenges)
    .where(eq(schema.designMotionBridgeReceiptChallenges.nonce, nonce))
    .limit(1);
  return Boolean(
    prior?.chainId === chainIdentity.chainId &&
    prior.receiptHash === receiptHash &&
    prior.expiresAt > nowIso &&
    (await isActiveMotionLocalhostRelayChain(chainIdentity)),
  );
}

function isValidBridgeResult(
  relay: LocalhostBridgeRelay,
  value: unknown,
): boolean {
  if (!isRecord(value)) return false;
  if (relay.operation === "read-file") {
    return (
      value.designId === relay.designId &&
      value.connectionId === relay.connectionId &&
      value.path === relay.path &&
      typeof value.content === "string" &&
      typeof value.versionHash === "string" &&
      typeof value.operationReceipt === "string"
    );
  }
  if (relay.operation === "verify-module-provenance") {
    return (
      value.designId === relay.designId &&
      value.connectionId === relay.connectionId &&
      value.routePath === relay.path &&
      value.modulePath === relay.relPath &&
      typeof value.reachable === "boolean" &&
      typeof value.operationReceipt === "string"
    );
  }
  if (relay.operation === "write-file" || relay.operation === "apply-edit") {
    return (
      value.designId === relay.designId &&
      value.relPath === relay.relPath &&
      value.written === true &&
      typeof value.versionHash === "string" &&
      value.operation ===
        (relay.operation === "write-file" ? "write" : "patch") &&
      typeof value.operationReceipt === "string"
    );
  }
  return false;
}
