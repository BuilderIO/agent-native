import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { canonicalizeNfm } from "../shared/nfm";
import {
  BODY_WRITERS,
  createOrganizationTables,
  FIXED_INPUTS,
  generatedInputs,
  UNDRIVEN_WRITERS,
  type BodyWriter,
} from "./_writers";
import { knownLossTest } from "./known-loss";

// SF-08 One stored form: after any write the stored body is canonical. Every
// writer in the stored-form writer map writes every input, and its check names
// each input whose stored body is not the canonical form of itself.

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

const AGENT_FORM_KEPT =
  "blank lines between paragraphs, snake\\_case, a bare $60, a GFM pipe table and trailing blank lines are stored as sent instead of in canonical form";

// What each writer did on main when this check was written.
const MAIN_LOSSES: Record<string, string> = {
  "create-document": `create-document stores the body it is given: ${AGENT_FORM_KEPT}.`,
  "edit-document initializeContent": `initializeContent stores the body it is given: ${AGENT_FORM_KEPT}.`,
  "edit-document find and replace": `A revisioned edit splices the replacement in as given: ${AGENT_FORM_KEPT}.`,
  "edit-document find and replace without a revision": `An unrevisioned edit splices the replacement in as given: ${AGENT_FORM_KEPT}.`,
  "update-document browser full rewrite": `A browser full rewrite stores the body it is given: ${AGENT_FORM_KEPT}.`,
  "restore-document-version":
    "Restoring a version writes its body back byte for byte, so a version saved in agent form restores a non-canonical body.",
  "local files: import-content-source new page": `import-content-source stores a new page's file body as written: ${AGENT_FORM_KEPT}.`,
  "local files: import-content-source existing page": `import-content-source stores an existing page's file body as written: ${AGENT_FORM_KEPT}.`,
  "local files: sync-local-folder-source new file": `A folder sync stores a new file's body as written: ${AGENT_FORM_KEPT}.`,
  "local files: sync-local-folder-source changed file": `A folder sync stores a changed file's body as written: ${AGENT_FORM_KEPT}.`,
  "set-document-property primary Blocks field": `Setting a row's primary Blocks field stores the value as the page body as given: ${AGENT_FORM_KEPT}.`,
  "duplicate-page":
    "A copy takes the source page's body byte for byte, so a page stored in agent form copies to a non-canonical body.",
  "set-image-alt-text":
    "Alt text is spliced into the stored body without the stored form's escaping (a bare $ stays bare), and the rest of a non-canonical body is saved unchanged.",
};

for (const name of Object.keys(MAIN_LOSSES))
  if (!BODY_WRITERS.some((writer) => writer.name === name))
    throw new Error(`MAIN_LOSSES names no writer in the map: ${name}`);

const TEST_DB_PATH = join(
  tmpdir(),
  `content-one-stored-form-${process.pid}-${Date.now()}.pglite`,
);

const INPUTS = [...FIXED_INPUTS, ...generatedInputs(6)];

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  await (await import("../server/plugins/db.js")).default(undefined as never);
  await createOrganizationTables();
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function nonCanonicalWrites(writer: BodyWriter) {
  const found: { input: string; stored: string; canonical: string }[] = [];
  for (const input of INPUTS) {
    const { after } = await writer.write(input);
    const canonical = canonicalizeNfm(after.content);
    if (after.content !== canonical)
      found.push({ input: input.name, stored: after.content, canonical });
  }
  return found;
}

describe("SF-08 every body writer stores the canonical form", () => {
  for (const writer of BODY_WRITERS) {
    const loss = MAIN_LOSSES[writer.name];
    it(
      writer.name,
      loss ? knownLossTest({ lane: "L3", outcome: "SF-08", reason: loss }) : {},
      async () => {
        expect(await nonCanonicalWrites(writer)).toEqual([]);
      },
    );
  }

  for (const writer of UNDRIVEN_WRITERS) {
    it(writer.name, ({ skip }) => {
      skip(`Needs ${writer.missing}.`);
    });
  }
});

// L3's D2 switch puts one page on the live-body path. Main has no switch, so
// these report skipped, never passed, until L3 lands it.
describe("SF-08 a switched page has one writer", () => {
  const NEEDS_SWITCH =
    "Needs L3's D2 per-page switch, which main does not have.";

  it("stores docToNfm of the live copy as the page body", ({ skip }) => {
    skip(NEEDS_SWITCH);
  });

  it("keeps collab_body_revision equal to body_revision", ({ skip }) => {
    skip(NEEDS_SWITCH);
  });

  it("refuses any other body write with a typed error", ({ skip }) => {
    skip(NEEDS_SWITCH);
  });
});
