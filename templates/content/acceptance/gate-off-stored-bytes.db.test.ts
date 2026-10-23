import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { LIVE_BODY_SHADOW_FLAG } from "../shared/feature-flags";
import {
  BODY_WRITERS,
  createOrganizationTables,
  FIXED_INPUTS,
  UNDRIVEN_WRITERS,
  WRITER_OWNER,
  type BodyWriter,
} from "./_writers";

// SF-11 Gate off changes nothing: with the live-body gate off, every writer in
// the stored-form writer map stores the bytes main stored for the same input.
//
// Each writer's golden in golden/gate-off-stored-bytes/ was captured from
// main. Vitest writes a missing golden only outside CI; under CI=true a missing
// or different golden fails. A change that means to alter what a writer
// stores with the gate off reruns this file with `-u` from templates/content
// (`npx vitest --run --config vitest.config.ts -u acceptance/gate-off-stored-bytes.db.test.ts`)
// and commits the golden diff with it, so the PR shows every changed byte.

vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppState: vi.fn(async () => undefined),
}));
vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));
// import-content keeps each original file in private blob storage.
vi.mock("@agent-native/core/private-blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/private-blob")>()),
  isPrivateBlobConfiguredForRequest: async () => true,
  putPrivateBlob: async (input: { key?: string; data: Uint8Array }) => ({
    id: input.key ?? "blob",
    provider: "test",
    opaque: true as const,
    encrypted: false,
    size: input.data.byteLength,
  }),
  deletePrivateBlob: async () => ({ deleted: true }),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-gate-off-stored-bytes-${process.pid}-${Date.now()}.pglite`,
);

const GATE_FLAG_PREFIX = "content.live-body-";

/**
 * Every registered live-body gate flag, as the writers' caller gets it.
 * isFeatureFlagEnabled reads an unreadable flag as off, which would let this
 * pass without reading anything, so the rules are read without that fallback.
 */
async function liveBodyGate(): Promise<Record<string, boolean>> {
  const { evaluateFeatureFlagRules, getFeatureFlagRules, listFeatureFlags } =
    await import("@agent-native/core/feature-flags");
  const scope = { userEmail: WRITER_OWNER, orgId: null };
  const keys = listFeatureFlags()
    .map((flag) => flag.key)
    .filter((key) => key.startsWith(GATE_FLAG_PREFIX));
  const gate: Record<string, boolean> = {};
  for (const key of keys)
    gate[key] = evaluateFeatureFlagRules(
      key,
      await getFeatureFlagRules(key, scope),
      scope,
    );
  return gate;
}

async function assertGateOff(): Promise<Record<string, boolean>> {
  const gate = await liveBodyGate();
  if (!(LIVE_BODY_SHADOW_FLAG.key in gate))
    throw new Error(
      `Content registered no ${LIVE_BODY_SHADOW_FLAG.key} flag, so this run cannot show the gate is off.`,
    );
  const on = Object.keys(gate).filter((key) => gate[key]);
  if (on.length > 0)
    throw new Error(`Live-body gate flags are on: ${on.join(", ")}.`);
  return gate;
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  await (await import("../server/plugins/db.js")).default(undefined as never);
  await (
    await import("../server/plugins/feature-flags.js")
  ).default(undefined as never);
  await createOrganizationTables();
  await assertGateOff();
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function goldenPath(writer: BodyWriter): string {
  const slug = writer.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `./golden/gate-off-stored-bytes/${slug.replace(/^-|-$/g, "")}.json`;
}

async function storedBytes(writer: BodyWriter): Promise<string> {
  const writes = [];
  for (const input of FIXED_INPUTS) {
    const { before, after } = await writer.write(input);
    writes.push({
      input: input.name,
      stored: after.content,
      bodyRevision: after.bodyRevision,
      bodyRevisionDelta: before
        ? after.bodyRevision - before.bodyRevision
        : null,
      collabBodyRevision: after.collabBodyRevision,
    });
  }
  return `${JSON.stringify({ writer: writer.name, writes }, null, 2)}\n`;
}

describe("SF-11 gate off stores what main stores", () => {
  it("reads every live-body gate flag as off", async () => {
    const gate = await assertGateOff();
    expect(Object.values(gate)).not.toContain(true);
  });

  for (const writer of BODY_WRITERS) {
    it(writer.name, async () => {
      await expect(await storedBytes(writer)).toMatchFileSnapshot(
        goldenPath(writer),
      );
    });
  }

  for (const writer of UNDRIVEN_WRITERS) {
    it(writer.name, ({ skip }) => {
      skip(`No golden: needs ${writer.missing}.`);
    });
  }
});
