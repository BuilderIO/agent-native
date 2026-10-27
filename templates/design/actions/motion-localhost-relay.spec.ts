import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usedNonces: new Map<string, Record<string, unknown>>(),
  relayChains: new Map<string, Record<string, unknown>>(),
  resolveScope: vi.fn().mockResolvedValue({
    ownerEmail: "motion-test@example.invalid",
    orgId: null,
  }),
  resolveConnection: vi.fn().mockResolvedValue({ bridgeToken: "bridge-token" }),
  receiptTable: {
    name: "receipts",
    nonce: { table: "receipts", key: "nonce" },
    expiresAt: { table: "receipts", key: "expiresAt" },
    chainId: { table: "receipts", key: "chainId" },
    receiptHash: { table: "receipts", key: "receiptHash" },
  },
  chainTable: {
    name: "chains",
    chainId: { table: "chains", key: "chainId" },
    actionName: { table: "chains", key: "actionName" },
    inputHash: { table: "chains", key: "inputHash" },
    expiresAt: { table: "chains", key: "expiresAt" },
    completedAt: { table: "chains", key: "completedAt" },
  },
  matches(condition: unknown, row: Record<string, unknown>) {
    if (!condition || typeof condition !== "object") return false;
    const candidate = condition as {
      kind?: string;
      column?: { key?: string };
      value?: unknown;
      conditions?: unknown[];
    };
    if (candidate.kind === "and") {
      return Boolean(
        candidate.conditions?.every((child) => mocks.matches(child, row)),
      );
    }
    const value = candidate.column?.key ? row[candidate.column.key] : undefined;
    if (candidate.kind === "eq") return value === candidate.value;
    if (candidate.kind === "gt") return String(value) > String(candidate.value);
    if (candidate.kind === "lt") return String(value) < String(candidate.value);
    if (candidate.kind === "is-null") return value == null;
    return false;
  },
  project(row: Record<string, unknown>, selection: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(selection).map(([name, column]) => [
        name,
        row[(column as { key: string }).key],
      ]),
    );
  },
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    delete: (table: { name: string }) => ({
      where: (condition: unknown) => {
        const rows =
          table === mocks.chainTable ? mocks.relayChains : mocks.usedNonces;
        for (const [key, row] of rows) {
          if (mocks.matches(condition, row)) rows.delete(key);
        }
        return Promise.resolve();
      },
    }),
    insert: (table: { name: string }) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: (selection: Record<string, unknown>) => {
            const rows =
              table === mocks.chainTable ? mocks.relayChains : mocks.usedNonces;
            const key = String(
              table === mocks.chainTable ? values.chainId : values.nonce,
            );
            if (rows.has(key)) return Promise.resolve([]);
            const row = {
              ...values,
              ...(table === mocks.chainTable ? { completedAt: null } : {}),
            };
            rows.set(key, row);
            return Promise.resolve([mocks.project(row, selection)]);
          },
        }),
      }),
    }),
    select: (selection: Record<string, unknown>) => ({
      from: (table: { name: string }) => ({
        where: (condition: unknown) => ({
          limit: () => {
            const rows =
              table === mocks.chainTable ? mocks.relayChains : mocks.usedNonces;
            const row = [...rows.values()].find((candidate) =>
              mocks.matches(condition, candidate),
            );
            return Promise.resolve(row ? [mocks.project(row, selection)] : []);
          },
        }),
      }),
    }),
    update: (table: { name: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: unknown) => ({
          returning: (selection: Record<string, unknown>) => {
            const rows =
              table === mocks.chainTable ? mocks.relayChains : mocks.usedNonces;
            const updated: Record<string, unknown>[] = [];
            for (const [key, row] of rows) {
              if (!mocks.matches(condition, row)) continue;
              const next = { ...row, ...values };
              rows.set(key, next);
              updated.push(mocks.project(next, selection));
            }
            return Promise.resolve(updated);
          },
        }),
      }),
    }),
  }),
  schema: {
    designMotionBridgeReceiptChallenges: mocks.receiptTable,
    designMotionBridgeRelayChains: mocks.chainTable,
  },
}));

vi.mock("../server/lib/localhost-connection.js", () => ({
  requireLocalhostBridgeToken: () => "bridge-token",
  resolveLocalhostBridgeConnection: mocks.resolveConnection,
  resolveLocalhostConnectionScope: mocks.resolveScope,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
    eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
    gt: (column: unknown, value: unknown) => ({ kind: "gt", column, value }),
    isNull: (column: unknown) => ({ kind: "is-null", column }),
    lt: (column: unknown, value: unknown) => ({ kind: "lt", column, value }),
  };
});

import { signShortLivedToken } from "@agent-native/core/server";

import {
  localhostBridgeRelayChallengeResourceId,
  LOCALHOST_BRIDGE_RELAY_MARKER,
  type LocalhostBridgeRelay,
} from "../shared/visual-edit-bridge-relay.js";
import {
  allMotionLocalhostRelayResponsesValidated,
  completeMotionLocalhostRelayChain,
  ensureMotionLocalhostRelayChain,
  isActiveMotionLocalhostRelayChain,
  localhostBridgeRelayContextWithResponses,
  markMotionLocalhostRelayResponseValidated,
  motionLocalhostRelayIdentity,
  runLocalhostBridgeStep,
  verifyLocalhostBridgeReceipt,
  withMotionLocalhostRelayIdentity,
} from "./motion-localhost-relay.js";

const RECEIPT_DOMAIN = "agent-native-design-motion-bridge-receipt-v1\0";

function challenge(relay: LocalhostBridgeRelay, nonce: string): string {
  return signShortLivedToken({
    resourceId: localhostBridgeRelayChallengeResourceId(relay),
    agentLabel: nonce,
    ttlSeconds: 120,
  });
}

function bridgeReceipt(
  relay: LocalhostBridgeRelay,
  result: Record<string, unknown>,
): string {
  const payload = relay.payload ?? {};
  const isProvenance = relay.operation === "verify-module-provenance";
  const payloadHash =
    relay.operation === "read-file" || isProvenance
      ? ""
      : typeof payload.content === "string"
        ? crypto
            .createHash("sha256")
            .update(`content\0${payload.content}`)
            .digest("hex")
        : "";
  const resultContentHash =
    relay.operation === "read-file" && typeof result.content === "string"
      ? crypto.createHash("sha256").update(result.content).digest("hex")
      : "";
  return crypto
    .createHmac("sha256", "bridge-token")
    .update(RECEIPT_DOMAIN)
    .update(
      JSON.stringify([
        relay.challenge,
        relay.operation,
        relay.operation === "read-file" ? relay.path : relay.relPath,
        isProvenance ? relay.path : null,
        isProvenance && typeof result.reachable === "boolean"
          ? result.reachable
          : null,
        typeof payload.expectedVersionHash === "string"
          ? payload.expectedVersionHash
          : null,
        payload.requireExpectedVersionHash === true,
        payloadHash,
        typeof result.versionHash === "string" ? result.versionHash : "",
        resultContentHash,
      ]),
    )
    .digest("hex");
}

function readRelay(nonce: string): LocalhostBridgeRelay {
  const relay: LocalhostBridgeRelay = {
    __agentNativeLocalhostBridge: LOCALHOST_BRIDGE_RELAY_MARKER,
    operation: "read-file",
    designId: "design-1",
    connectionId: "connection-1",
    step: "source-read",
    path: "app/routes/home.tsx",
  };
  relay.challenge = challenge(relay, nonce);
  return relay;
}

function responseFor(relay: LocalhostBridgeRelay) {
  const result: Record<string, unknown> = {
    designId: relay.designId,
    connectionId: relay.connectionId,
    path: relay.path,
    content: "export default function Home() {}\n",
    versionHash: "b".repeat(64),
  };
  result.operationReceipt = bridgeReceipt(relay, result);
  return result;
}

function invoke(relay: LocalhostBridgeRelay, result: unknown) {
  const context = localhostBridgeRelayContextWithResponses(
    { caller: "frontend" } as never,
    [{ relay, result }],
  );
  return runLocalhostBridgeStep({
    action: {
      run: () => ({
        ...relay,
        challenge: "fresh-action-challenge",
      }),
    },
    actionArgs: {},
    context,
    step: relay.step!,
  });
}

const chainIdentity = (
  overrides: Partial<{
    chainId: string;
    actionName: "get-motion-timeline" | "apply-motion-edit";
    inputHash: string;
  }> = {},
) => ({
  chainId: "123e4567-e89b-42d3-a456-426614174000",
  actionName: "get-motion-timeline" as const,
  inputHash: "a".repeat(64),
  ...overrides,
});

beforeEach(() => {
  mocks.usedNonces.clear();
  mocks.relayChains.clear();
});

describe("Motion localhost bridge receipts", () => {
  it("binds a Motion relay identity to its action and normalized input", () => {
    const chainId = "123e4567-e89b-42d3-a456-426614174000";
    const context = {
      actionName: "get-motion-timeline",
      requestHeaders: new Headers({
        "x-agent-native-motion-relay-chain": chainId,
      }),
    } as never;
    const identityContext = withMotionLocalhostRelayIdentity(
      context,
      "get-motion-timeline",
      { nodeId: "node-1", designId: "design-1" },
    );
    const identity = motionLocalhostRelayIdentity(identityContext);
    const reorderedIdentity = motionLocalhostRelayIdentity(
      withMotionLocalhostRelayIdentity(context, "get-motion-timeline", {
        designId: "design-1",
        nodeId: "node-1",
      }),
    );

    expect(identity?.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reorderedIdentity?.inputHash).toBe(identity?.inputHash);
    expect(() =>
      withMotionLocalhostRelayIdentity(context, "apply-motion-edit", {
        designId: "design-1",
        nodeId: "node-1",
      }),
    ).toThrowError("The Motion relay action does not match this request.");
  });

  it("keeps a chain bound to its action and input, then rejects it after completion", async () => {
    const identity = chainIdentity();
    expect(await ensureMotionLocalhostRelayChain(identity)).toBe(true);
    expect(await ensureMotionLocalhostRelayChain(identity)).toBe(true);
    expect(await isActiveMotionLocalhostRelayChain(identity)).toBe(true);
    expect(
      await ensureMotionLocalhostRelayChain({
        ...identity,
        inputHash: "b".repeat(64),
      }),
    ).toBe(false);
    expect(
      await completeMotionLocalhostRelayChain({
        ...identity,
        actionName: "apply-motion-edit",
      }),
    ).toBe(false);
    expect(await completeMotionLocalhostRelayChain(identity)).toBe(true);
    expect(await isActiveMotionLocalhostRelayChain(identity)).toBe(false);
    expect(await ensureMotionLocalhostRelayChain(identity)).toBe(false);
  });

  it("allows exact receipt replay only inside the active originating chain", async () => {
    const identity = chainIdentity();
    const otherIdentity = chainIdentity({
      chainId: "223e4567-e89b-42d3-a456-426614174001",
    });
    expect(await ensureMotionLocalhostRelayChain(identity)).toBe(true);
    expect(await ensureMotionLocalhostRelayChain(otherIdentity)).toBe(true);

    const nonce = "5".repeat(64);
    const relay = readRelay(nonce);
    Object.assign(relay, identity);
    relay.challenge = challenge(relay, nonce);
    const result = responseFor(relay);

    expect(await verifyLocalhostBridgeReceipt(relay, result)).toBe(true);
    expect(await verifyLocalhostBridgeReceipt(relay, result)).toBe(true);

    const crossChainRelay = readRelay(nonce);
    Object.assign(crossChainRelay, otherIdentity);
    crossChainRelay.challenge = challenge(crossChainRelay, nonce);
    const crossChainResult = responseFor(crossChainRelay);
    expect(
      await verifyLocalhostBridgeReceipt(crossChainRelay, crossChainResult),
    ).toBe(false);

    expect(await completeMotionLocalhostRelayChain(identity)).toBe(true);
    expect(await verifyLocalhostBridgeReceipt(relay, result)).toBe(false);
  });

  it("requires every unique supplied receipt to be validated before completion", () => {
    const relay = readRelay("6".repeat(64));
    relay.challenge = "first-challenge";
    const secondRelay = { ...relay, challenge: "second-challenge" };
    const context = localhostBridgeRelayContextWithResponses(
      { caller: "frontend" } as never,
      [
        { relay, result: {} },
        { relay: secondRelay, result: {} },
      ],
    );

    markMotionLocalhostRelayResponseValidated(context, relay.challenge);
    expect(
      allMotionLocalhostRelayResponsesValidated(context, [
        { relay, result: {} },
        { relay: secondRelay, result: {} },
      ]),
    ).toBe(false);
    markMotionLocalhostRelayResponseValidated(context, secondRelay.challenge!);
    expect(
      allMotionLocalhostRelayResponsesValidated(context, [
        { relay, result: {} },
        { relay: secondRelay, result: {} },
      ]),
    ).toBe(true);
    expect(
      allMotionLocalhostRelayResponsesValidated(context, [
        { relay, result: {} },
        { relay, result: {} },
      ]),
    ).toBe(false);
  });

  it("rejects fabricated read results and consumes a valid receipt only once", async () => {
    const relay = readRelay("1".repeat(64));
    const forged = responseFor(relay);
    forged.operationReceipt = "f".repeat(64);
    await expect(invoke(relay, forged)).rejects.toMatchObject({
      errorCode: "localhost_bridge_relay_invalid_receipt",
    });

    const valid = responseFor(relay);
    await expect(invoke(relay, valid)).resolves.toMatchObject({
      content: "export default function Home() {}\n",
      versionHash: "b".repeat(64),
    });
    await expect(invoke(relay, valid)).rejects.toMatchObject({
      errorCode: "localhost_bridge_relay_invalid_receipt",
    });
  });

  it("authenticates the exact write payload and resulting version hash", async () => {
    const relay: LocalhostBridgeRelay = {
      __agentNativeLocalhostBridge: LOCALHOST_BRIDGE_RELAY_MARKER,
      operation: "write-file",
      designId: "design-1",
      connectionId: "connection-1",
      step: "source-write",
      relPath: "app/routes/home.tsx",
      payload: {
        relPath: "app/routes/home.tsx",
        content: "export default function Home() { return null; }\n",
        expectedVersionHash: "a".repeat(64),
        requireExpectedVersionHash: true,
      },
    };
    relay.challenge = challenge(relay, "2".repeat(64));
    const result: Record<string, unknown> = {
      designId: relay.designId,
      relPath: relay.relPath,
      operation: "write",
      written: true,
      versionHash: "c".repeat(64),
    };
    result.operationReceipt = bridgeReceipt(relay, result);

    await expect(invoke(relay, result)).resolves.toMatchObject({
      written: true,
      versionHash: "c".repeat(64),
    });
  });

  it("authenticates provenance results against the exact route and candidate", async () => {
    const relay: LocalhostBridgeRelay = {
      __agentNativeLocalhostBridge: LOCALHOST_BRIDGE_RELAY_MARKER,
      operation: "verify-module-provenance",
      designId: "design-1",
      connectionId: "connection-1",
      step: "source-provenance",
      path: "app/routes/home.tsx",
      relPath: "app/components/Card.tsx",
    };
    relay.challenge = challenge(relay, "3".repeat(64));
    const result: Record<string, unknown> = {
      designId: relay.designId,
      connectionId: relay.connectionId,
      routePath: relay.path,
      modulePath: relay.relPath,
      reachable: true,
    };
    result.operationReceipt = bridgeReceipt(relay, result);

    await expect(invoke(relay, result)).resolves.toMatchObject({
      routePath: "app/routes/home.tsx",
      modulePath: "app/components/Card.tsx",
      reachable: true,
    });

    const wrongRouteChallengeRelay = { ...relay, challenge: undefined };
    wrongRouteChallengeRelay.path = "app/routes/other.tsx";
    const wrongRouteChallenge = challenge(
      wrongRouteChallengeRelay,
      "4".repeat(64),
    );
    const wrongChallengeRelay = { ...relay, challenge: wrongRouteChallenge };
    const forged = { ...result };
    forged.operationReceipt = bridgeReceipt(wrongChallengeRelay, forged);
    await expect(invoke(wrongChallengeRelay, forged)).rejects.toMatchObject({
      errorCode: "localhost_bridge_relay_invalid_receipt",
    });
  });
});
