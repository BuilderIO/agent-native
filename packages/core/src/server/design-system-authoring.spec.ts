import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { defineAction, fail } from "../action.js";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "../private-blob/index.js";
import {
  designSystemArtifactInputFromContent,
  writeDesignSystemArtifactAgentSchema,
} from "../shared/design-system-authoring.js";
import {
  authoredDesignSystemAgentContext,
  createDesignSystemAuthoringService,
  designSystemGenerationData,
} from "./design-system-authoring.js";
import type { DesignSystemNativeThreadState } from "./design-system-native-run.js";
import { readDesignSystemSource } from "./design-system-source-reader.js";
import {
  getRequestUserEmail,
  runWithRequestContext,
} from "./request-context.js";

const systems = pgTable("authoring_test_systems", {
  id: text().primaryKey(),
  title: text().notNull(),
  data: text().notNull(),
  ownerEmail: text().notNull(),
});
const database = new PGlite();
const db = drizzle(database);
const blobs = new Map<string, Uint8Array>();
const state: DesignSystemNativeThreadState = {
  exists: false,
  messageCount: 0,
  kickoffReceived: false,
  run: null,
};
let canWrite = true;
const service = createDesignSystemAuthoringService({
  ownerApp: "design",
  nativeThreadState: async () => state,
  async read(id, write) {
    const [row] = await db
      .select()
      .from(systems)
      .where(
        and(
          eq(systems.id, id),
          eq(systems.ownerEmail, getRequestUserEmail() ?? ""),
        ),
      );
    if (!row) return fail("not found", { statusCode: 404 });
    if (write && !canWrite) return fail("editor required", { statusCode: 403 });
    return { row, canEdit: canWrite };
  },
  async insert(row) {
    await db.insert(systems).values(row).onConflictDoNothing();
  },
  async compareAndSwap(row, data) {
    const changed = await db
      .update(systems)
      .set({ data })
      .where(
        and(
          eq(systems.id, row.id),
          eq(systems.data, row.data),
          eq(systems.ownerEmail, getRequestUserEmail() ?? ""),
        ),
      )
      .returning();
    return changed.length === 1;
  },
});
const asOwner = <T>(run: () => T) =>
  runWithRequestContext(
    { userEmail: "owner@example.test", orgId: "org-test" },
    run,
  );
const start = () =>
  service.start({
    requestId: "create-request",
    title: "Actual system",
    intent: "fresh",
    sources: [],
  });
const html =
  "<!doctype html><html><head><style>button{border-radius:12px}</style></head><body><button type=button>Actual button</button></body></html>";
const writeAction = defineAction({
  description: "Write an actual design-system artifact",
  schema: writeDesignSystemArtifactAgentSchema,
  audit: false,
  run: (args) => service.write(designSystemArtifactInputFromContent(args)),
});

beforeAll(async () => {
  await database.exec(
    'CREATE TABLE authoring_test_systems (id text PRIMARY KEY, title text NOT NULL, data text NOT NULL, "ownerEmail" text NOT NULL)',
  );
  registerPrivateBlobProvider({
    id: "authoring-test",
    name: "Test private storage",
    isConfigured: () => true,
    async put(input) {
      const id = `body-${blobs.size}`;
      blobs.set(id, new Uint8Array(input.data));
      return {
        id,
        provider: "authoring-test",
        opaque: true,
        encrypted: false,
        mimeType: input.mimeType,
        size: input.data.byteLength,
      };
    },
    async read(handle) {
      const data = blobs.get(handle.id);
      if (!data) throw new Error("missing blob");
      return { handle, data };
    },
    async delete(handle) {
      return { provider: "authoring-test", deleted: blobs.delete(handle.id) };
    },
  });
}, 20000);
beforeEach(async () => {
  await db.delete(systems);
  blobs.clear();
  canWrite = true;
  Object.assign(state, {
    exists: false,
    messageCount: 0,
    kickoffReceived: false,
    run: null,
  });
});
afterAll(async () => {
  unregisterPrivateBlobProvider("authoring-test");
  await database.close();
});

describe("durable design-system authoring through PostgreSQL CAS and private artifacts", () => {
  it("corrects historical attribution through an artifact revision while preserving extracted source evidence", () =>
    asOwner(async () => {
      const { id } = await start();
      await service.update({
        id,
        expectedRevision: 0,
        operationId: "stage-observed-source",
        sources: [
          { id: "website", kind: "website", url: "https://example.test" },
        ],
        sourceUpdates: [
          {
            id: "website",
            status: "ready",
            evidence: "Observed text black; no surface role was observed.",
            provenance: "extracted",
            error: null,
          },
        ],
      });
      await service.write({
        id,
        targetId: "colors",
        expectedRevision: 0,
        operationId: "historical-attribution",
        kind: "foundation",
        name: "Colors",
        provenance: "extracted",
        sourceIds: ["website"],
        values: { text: "#000000", surface: "#ffffff" },
      });
      const corrected = await writeAction.run({
        id,
        targetId: "colors",
        expectedRevision: 1,
        operationId: "correct-attribution",
        name: "Colors",
        provenance: "inferred",
        sourceIds: ["website"],
        content: {
          kind: "foundation",
          tokens: [
            { name: "text", value: "#000000" },
            { name: "surface", value: "#ffffff" },
          ],
        },
      });
      expect(corrected.workspace!.artifacts[0]).toMatchObject({
        revision: 2,
        provenance: "inferred",
        values: { text: "#000000", surface: "#ffffff" },
        history: [{ revision: 1, provenance: "extracted" }],
      });
      expect(corrected.workspace!.sources[0]).toMatchObject({
        status: "ready",
        provenance: "extracted",
        evidence: "Observed text black; no surface role was observed.",
      });
      expect(corrected.receipt).toMatchObject({
        persisted: true,
        targetId: "colors",
        revision: 2,
      });
    }));
  it("persists model-facing payloads through action validation and scoped SQL/private storage", () =>
    asOwner(async () => {
      const { id } = await start();
      const foundationResult = await writeAction.run({
        id,
        targetId: "typography",
        expectedRevision: 0,
        operationId: "canonical-type",
        name: "Typography",
        provenance: "generated",
        sourceIds: [],
        content: {
          kind: "foundation",
          tokens: [
            { name: "headingFont", value: "Inter" },
            { name: "headingSizes.h1", value: "48px" },
          ],
        },
      });
      expect(foundationResult.receipt).toMatchObject({
        persisted: true,
        targetId: "typography",
        kind: "foundation",
        revision: 1,
        tokenCount: 2,
        contentHash: null,
      });
      const componentResult = await writeAction.run({
        id,
        targetId: "button",
        expectedRevision: 0,
        operationId: "canonical-component",
        name: "Button",
        provenance: "generated",
        sourceIds: [],
        content: { kind: "component", html },
      });
      expect(componentResult.receipt).toMatchObject({
        persisted: true,
        targetId: "button",
        kind: "component",
        revision: 1,
        tokenCount: 0,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      const [persisted] = await db
        .select()
        .from(systems)
        .where(eq(systems.id, id));
      expect(JSON.parse(persisted.data).typography).toEqual({
        headingFont: "Inter",
        headingSizes: { h1: "48px" },
      });
      expect(persisted.data).not.toContain("Actual button");
      expect((await service.getArtifact(id, "button")).html).toBe(html);
    }));
  it("creates once, writes real HTML outside SQL, revises exactly one target, and reads retained bodies", () =>
    asOwner(async () => {
      const created = await start();
      expect((await start()).id).toBe(created.id);
      await expect(
        service.start({
          requestId: "create-request",
          title: "Different",
          intent: "fresh",
          sources: [],
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
      const input = {
        id: created.id,
        targetId: "button",
        expectedRevision: 0,
        operationId: "write-button",
        kind: "component" as const,
        name: "Button",
        provenance: "generated" as const,
        sourceIds: [],
        html,
      };
      const first = await service.write(input);
      expect((await service.write(input)).receipt).toEqual(first.receipt);
      expect((await service.write(input)).workspace?.revision).toBe(
        first.workspace?.revision,
      );
      const [persisted] = await db
        .select()
        .from(systems)
        .where(eq(systems.id, created.id));
      expect(persisted.data).not.toContain("Actual button");
      expect((await service.getArtifact(created.id, "button")).html).toBe(html);
      const secondHtml = html.replace("12px", "24px");
      await service.write({
        ...input,
        operationId: "revise-button",
        expectedRevision: 1,
        html: secondHtml,
      });
      expect((await service.getArtifact(created.id, "button")).html).toBe(
        secondHtml,
      );
      expect((await service.getArtifact(created.id, "button", 1)).html).toBe(
        html,
      );
      await expect(
        service.write({ ...input, operationId: "stale-button", html: "stale" }),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(
        (await service.getArtifact(created.id, "button")).artifact.revision,
      ).toBe(2);
      expect((await service.write(input)).receipt).toEqual(first.receipt);
      expect(
        authoredDesignSystemAgentContext(
          (await service.get(created.id)).workspace!,
        ),
      ).toContain('ownerApp:"design"');
    }));

  it("protects reads and writes from other users and viewer-only access", () =>
    asOwner(async () => {
      const { id } = await start();
      await expect(
        runWithRequestContext(
          { userEmail: "other@example.test", orgId: "org-test" },
          () => service.get(id),
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
      canWrite = false;
      expect((await service.get(id)).canEdit).toBe(false);
      await expect(
        service.update({
          id,
          expectedRevision: 0,
          operationId: "viewer-write",
          selectedTargetId: null,
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    }));

  it("claims once across tabs, recovers lost ACK from exact receipt, and appends a fresh kickoff on an existing thread", () =>
    asOwner(async () => {
      const { id } = await start();
      const attempts = await Promise.allSettled([
        service.claimKickoff(id),
        service.claimKickoff(id),
      ]);
      expect(
        attempts.filter(
          (result) =>
            result.status === "fulfilled" && result.value.shouldDispatch,
        ),
      ).toHaveLength(1);
      const original = (await service.get(id)).workspace!;
      state.exists = true;
      state.messageCount = 10;
      state.kickoffReceived = true;
      expect((await service.claimKickoff(id)).shouldDispatch).toBe(false);
      const current = (await service.get(id)).workspace!;
      const append = {
        id,
        expectedRevision: current.revision,
        operationId: "append-request",
        sources: [
          {
            id: "new-site",
            kind: "website" as const,
            url: "https://example.test",
          },
        ],
      };
      const appended = await service.update(append);
      expect(appended.workspace!.kickoff!.requestId).not.toBe(
        original.kickoff!.requestId,
      );
      expect(appended.workspace!.conversationId).toBe(original.conversationId);
      expect((await service.update(append)).workspace!.kickoff!.requestId).toBe(
        appended.workspace!.kickoff!.requestId,
      );
      state.kickoffReceived = false;
      const next = await service.claimKickoff(id);
      expect(next).toMatchObject({
        shouldDispatch: true,
        knownNewThread: false,
      });
      expect((await service.claimKickoff(id)).shouldDispatch).toBe(false);
    }));

  it("does not confuse client acceptance with durable delivery after browser close", () =>
    asOwner(async () => {
      const { id } = await start();
      const claim = await service.claimKickoff(id);
      const accepted = await service.completeKickoff({
        id,
        claimId: claim.claimId!,
        status: "delivered",
      });
      expect(accepted.workspace!.kickoff!.status).toBe("claimed");
      const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61000);
      try {
        const recovered = await service.claimKickoff(id);
        expect(recovered.shouldDispatch).toBe(true);
        expect(recovered.requestId).toBe(claim.requestId);
        state.exists = true;
        state.kickoffReceived = true;
        expect((await service.claimKickoff(id)).shouldDispatch).toBe(false);
      } finally {
        now.mockRestore();
      }
    }));

  it("keeps content revisions stable through selection/kickoff/progress, not real edits", () =>
    asOwner(async () => {
      const { id } = await start();
      await service.claimKickoff(id);
      const current = (await service.get(id)).workspace!;
      const selected = await service.update({
        id,
        expectedRevision: current.revision,
        operationId: "select",
        selectedTargetId: null,
      });
      expect(selected.workspace!.contentRevision).toBe(0);
      expect(selected.workspace!.revision).toBeGreaterThan(0);
      const edited = await service.write({
        id,
        targetId: "colors",
        expectedRevision: 0,
        operationId: "edit",
        kind: "foundation",
        name: "Colors",
        provenance: "manual",
        sourceIds: [],
        values: { primary: "#123456" },
      });
      expect(edited.workspace!.contentRevision).toBe(1);
    }));

  it("preserves legacy actual tokens/guidance and exposes only existing foundations on resume", () =>
    asOwner(async () => {
      const data = {
        colors: { primary: "#123456" },
        typography: {
          headingFont: "Actual Font",
          headingSizes: { h1: "60px", h2: "40px" },
        },
        notes: "Known brand guidance",
        customCSS: ":root{--actual:24px}",
        source: "builder",
        builderDesignSystemId: "legacy-provider-id",
      };
      await db.insert(systems).values({
        id: "legacy",
        title: "Legacy",
        ownerEmail: "owner@example.test",
        data: JSON.stringify(data),
      });
      const resumed = await service.resume("legacy");
      expect(
        resumed.workspace!.artifacts.map((artifact) => artifact.id),
      ).toEqual(["colors", "typography"]);
      expect(authoredDesignSystemAgentContext(resumed.workspace!)).toContain(
        "Actual Font",
      );
      const [persisted] = await db
        .select()
        .from(systems)
        .where(eq(systems.id, "legacy"));
      expect(JSON.parse(persisted.data)).toMatchObject(data);
    }));

  it("records failed source reads honestly and retains excluded failed refs without touching artifacts", () =>
    asOwner(async () => {
      const { id } = await start();
      await service.update({
        id,
        expectedRevision: 0,
        operationId: "append",
        sources: [{ id: "site", kind: "website", url: "https://example.test" }],
      });
      await expect(
        readDesignSystemSource({ id, sourceId: "site" }, service, {
          website: async () => {
            throw new Error("unavailable");
          },
          figma: vi.fn(),
        }),
      ).rejects.toMatchObject({
        errorCode: "design_system_source_read_failed",
      });
      const failed = (await service.get(id)).workspace!;
      expect(failed.sources[0]).toMatchObject({
        status: "needs-attention",
        error: { code: "design_system_source_read_failed" },
      });
      const excluded = await service.update({
        id,
        expectedRevision: failed.revision,
        operationId: "exclude",
        sourceExclusions: [{ id: "site", excluded: true }],
      });
      expect(excluded.workspace!.sources[0]).toMatchObject({
        excluded: true,
        status: "needs-attention",
        url: "https://example.test",
      });
      await expect(
        readDesignSystemSource({ id, sourceId: "site" }, service, {
          website: vi.fn(),
          figma: vi.fn(),
        }),
      ).rejects.toMatchObject({ errorCode: "design_system_source_excluded" });
    }));

  it("reconciles an actual stopped run and rejects incomplete completion", () =>
    asOwner(async () => {
      const { id } = await start();
      state.exists = true;
      state.run = { runId: "native-run-1", status: "running" };
      await service.update({
        id,
        expectedRevision: 0,
        operationId: "running",
        run: {
          id: "native-run-1",
          status: "running",
          stage: "building-components",
          error: null,
        },
      });
      state.run = {
        runId: "native-run-1",
        status: "aborted",
        terminalReason: "user cancelled",
      };
      const stopped = await service.get(id);
      expect(stopped.workspace!.run).toMatchObject({
        status: "cancelled",
        error: { message: "user cancelled" },
      });
      state.run.status = "completed";
      await expect(
        service.update({
          id,
          expectedRevision: stopped.workspace!.revision,
          operationId: "false-complete",
          run: {
            id: "native-run-1",
            status: "completed",
            stage: "ready",
            error: null,
          },
        }),
      ).rejects.toMatchObject({ errorCode: "design_system_incomplete" });
    }));

  it("binds real native clarification turns without mistaking completion for system readiness", () =>
    asOwner(async () => {
      const { id } = await start();
      await expect(
        service.bindRun({ id, runId: "not-this-thread" }),
      ).rejects.toMatchObject({ statusCode: 409 });
      state.exists = true;
      state.run = { runId: "clarification", status: "running" };
      const bound = await service.bindRun({ id, runId: "clarification" });
      expect(bound.workspace!.run?.status).toBe("running");
      expect(
        (await service.bindRun({ id, runId: "clarification" })).workspace!
          .revision,
      ).toBe(bound.workspace!.revision);
      state.run.status = "completed";
      const awaiting = await service.get(id);
      expect(awaiting.workspace!.run).toMatchObject({
        id: "clarification",
        status: "completed",
        stage: "awaiting-input",
        error: null,
      });
      expect(awaiting.workspace!.contentRevision).toBe(0);
    }));

  it("requires usable target payloads and an actual native run, then completes with explicitly excluded failed sources", () =>
    asOwner(async () => {
      const { id } = await start();
      await expect(
        service.update({
          id,
          expectedRevision: 0,
          operationId: "invented-run",
          run: {
            id: "made-up",
            status: "running",
            stage: "building-components",
            error: null,
          },
        }),
      ).rejects.toMatchObject({ errorCode: "design_system_run_not_found" });
      await expect(
        service.write({
          id,
          targetId: "button",
          expectedRevision: 0,
          operationId: "empty",
          kind: "component",
          name: "Empty",
          provenance: "generated",
          sourceIds: [],
          html: "<html><body><script>console.log('empty')</script></body></html>",
        }),
      ).rejects.toMatchObject({ errorCode: "design_system_html_empty" });
      for (const [targetId, values] of Object.entries({
        colors: {
          primary: "#123456",
          secondary: "#654321",
          accent: "#ff6600",
          background: "#ffffff",
          surface: "#fafafa",
          text: "#111111",
          textMuted: "#555555",
        },
        typography: {
          headingFont: "Inter",
          bodyFont: "Inter",
          headingWeight: "700",
          bodyWeight: "400",
          "headingSizes.h1": "48px",
          "headingSizes.h2": "32px",
          "headingSizes.h3": "24px",
        },
        spacing: { elementGap: "16px", pagePadding: "24px" },
        radius: {
          "radius.sm": "8px",
          "radius.md": "14px",
          "radius.lg": "22px",
          "radius.pill": "999px",
        },
      }))
        await service.write({
          id,
          targetId,
          expectedRevision: 0,
          operationId: `write-${targetId}`,
          kind: "foundation",
          name: targetId,
          provenance: "manual",
          sourceIds: [],
          values,
        });
      for (const [targetId, markup] of Object.entries({
        button: "<button>Continue</button>",
        input: "<label>Email<input type=email></label>",
        card: "<article><h2>Profile</h2><p>Account information</p></article>",
        avatar: '<img src="https://example.test/avatar.png" alt="Person">',
      }))
        await service.write({
          id,
          targetId,
          expectedRevision: 0,
          operationId: `write-${targetId}`,
          kind: "component",
          name: targetId,
          provenance: "generated",
          sourceIds: [],
          html: `<html><body>${markup}</body></html>`,
        });
      await service.write({
        id,
        targetId: "usage",
        expectedRevision: 0,
        operationId: "write-usage",
        kind: "usage-rule",
        name: "Usage",
        provenance: "manual",
        sourceIds: [],
        text: "Use the primary button once per form.",
      });
      let workspace = (await service.get(id)).workspace!;
      await service.update({
        id,
        expectedRevision: workspace.revision,
        operationId: "failed-ref",
        sources: [
          { id: "failed-source", kind: "website", url: "https://example.test" },
        ],
        sourceUpdates: [
          {
            id: "failed-source",
            status: "needs-attention",
            evidence: null,
            provenance: null,
            error: {
              code: "unavailable",
              message: "Unavailable",
              retryable: true,
            },
          },
        ],
      });
      workspace = (await service.get(id)).workspace!;
      state.exists = true;
      state.run = { runId: "real-native-run", status: "running" };
      const run = {
        id: "real-native-run",
        status: "completed" as const,
        stage: "ready" as const,
        error: null,
      };
      await expect(
        service.update({
          id,
          expectedRevision: workspace.revision,
          operationId: "native-still-running",
          run,
        }),
      ).rejects.toMatchObject({ errorCode: "design_system_run_in_progress" });
      state.run.status = "completed";
      await expect(
        service.update({
          id,
          expectedRevision: workspace.revision,
          operationId: "premature",
          run,
        }),
      ).rejects.toMatchObject({ errorCode: "design_system_incomplete" });
      const complete = await service.update({
        id,
        expectedRevision: workspace.revision,
        operationId: "user-excluded-and-completed",
        sourceExclusions: [{ id: "failed-source", excluded: true }],
        run,
      });
      expect(complete.workspace!.run?.status).toBe("completed");
      expect(complete.workspace!.artifacts).toHaveLength(9);
      expect(complete.workspace!.sources[0].error?.code).toBe("unavailable");
      state.run.status = "completed";
      expect((await service.get(id)).workspace!.run?.stage).toBe("ready");
      const contentRevision = complete.workspace!.contentRevision;
      state.run = { runId: "actual-refinement", status: "running" };
      expect((await service.get(id)).workspace!.run).toMatchObject({
        id: "actual-refinement",
        status: "running",
      });
      state.run.status = "completed";
      const reconciled = (await service.get(id)).workspace!;
      expect(reconciled.run).toMatchObject({
        id: "actual-refinement",
        status: "completed",
        stage: "ready",
      });
      expect(reconciled.contentRevision).toBe(contentRevision);
      const [persisted] = await db
        .select()
        .from(systems)
        .where(eq(systems.id, id));
      const previousData = JSON.parse(persisted.data);
      delete previousData.borders.radius;
      const raw = JSON.stringify(previousData);
      expect(designSystemGenerationData(raw).borders).toMatchObject({
        radius: "14px",
        "radius.md": "14px",
      });
      expect(
        JSON.parse(raw).authoring.artifacts.find(
          (artifact: { id: string }) => artifact.id === "radius",
        ).revision,
      ).toBe(1);
    }));
});
