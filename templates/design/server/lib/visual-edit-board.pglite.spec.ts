import type { ActionRunContext } from "@agent-native/core/action";
import { closeDbExec, type DbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { getSetting } from "@agent-native/core/settings";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const versions = vi.hoisted(() => ({ skipSnapshots: false }));

// A nearly 1 MiB board's pre-edit checkpoint needs private blob storage,
// which this database-only harness does not have.
vi.mock("./design-versions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./design-versions.js")>();
  return {
    ...actual,
    snapshotDesignBeforeAgentEdit: (
      ...args: Parameters<typeof actual.snapshotDesignBeforeAgentEdit>
    ) =>
      versions.skipSnapshots
        ? Promise.resolve(undefined)
        : actual.snapshotDesignBeforeAgentEdit(...args),
  };
});

import addBreakpoint from "../../actions/add-breakpoint.js";
import addLocalhostScreens from "../../actions/add-localhost-screens.js";
import applyTweaks from "../../actions/apply-tweaks.js";
import claimAction from "../../actions/claim-visual-edit-board.js";
import createFile from "../../actions/create-file.js";
import getDesign from "../../actions/get-design.js";
import listLocalhostConnections from "../../actions/list-localhost-connections.js";
import migrateBoardObjectsToFile from "../../actions/migrate-board-objects-to-file.js";
import readLocalFile from "../../actions/read-local-file.js";
import renameScreen from "../../actions/rename-screen.js";
import updateDesign from "../../actions/update-design.js";
import updateFile from "../../actions/update-file.js";
import updateScreenSource from "../../actions/update-screen-source.js";
import { LOCAL_VISUAL_EDIT_PRINCIPAL_DOMAIN } from "../../shared/local-visual-edit-principal.js";
import {
  sourceContentHash,
  sourceContentPatch,
} from "../../shared/source-workspace.js";
import { bootDesignDatabase } from "./failed-write-test-harness.js";
import {
  claimVisualEditBoard,
  issueVisualEditBoardClaim,
} from "./visual-edit-board-claim.js";
import {
  linkVisualEditBoardConnections,
  VISUAL_EDIT_BOARD_MAX_DATA_BYTES,
  VISUAL_EDIT_BOARD_MAX_FILE_BYTES,
  VISUAL_EDIT_BOARD_MAX_FILES,
} from "./visual-edit-capability.js";

// Signed-out boards against a real database: every signed-out tab for one
// workspace path shares this principal, so it owns every board below.
const PRINCIPAL = `workspace+abc123@${LOCAL_VISUAL_EDIT_PRINCIPAL_DOMAIN}`;
const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const frontend: ActionRunContext = { caller: "frontend" };

let exec: DbExec;

async function seedBoard(
  id: string,
  ownerEmail = PRINCIPAL,
  data: Record<string, unknown> = { visualEditBoard: true },
  visibility: "private" | "public" = "private",
) {
  await exec.execute({
    sql: "INSERT INTO designs (id, title, data, owner_email, visibility) VALUES (?, ?, ?, ?, ?)",
    args: [id, "Board", JSON.stringify(data), ownerEmail, visibility],
  });
  await exec.execute({
    sql: "INSERT INTO design_files (id, design_id, filename, file_type, content) VALUES (?, ?, ?, ?, ?)",
    args: [
      `${id}:board`,
      id,
      "__board__.html",
      "html",
      "<html><body></body></html>",
    ],
  });
}

async function seedConnection(id: string, port: number) {
  await exec.execute({
    sql: "INSERT INTO design_localhost_connections (id, name, dev_server_url, bridge_url, bridge_token, preview_token, owner_email, org_id, route_manifest) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)",
    args: [
      id,
      id,
      `http://localhost:${port}`,
      `http://127.0.0.1:${port + 1000}`,
      `${id}-bridge-token`,
      `${id}-preview-token`,
      PRINCIPAL,
      JSON.stringify({
        version: 1,
        sourceType: "localhost",
        devServerUrl: `http://localhost:${port}`,
        routes: [{ id: "home", path: "/" }],
        generatedAt: "2026-11-17T00:00:00.000Z",
      }),
    ],
  });
}

async function fillBoard(designId: string, files: number) {
  for (let index = 0; index < files; index += 1) {
    await exec.execute({
      sql: "INSERT INTO design_files (id, design_id, filename, file_type, content) VALUES (?, ?, ?, ?, ?)",
      args: [
        `${designId}:fill-${index}`,
        designId,
        `fill-${index}.html`,
        "html",
        "<p>screen</p>",
      ],
    });
  }
}

async function fileCount(designId: string) {
  const { rows } = await exec.execute({
    sql: "SELECT COUNT(*) AS files FROM design_files WHERE design_id = ?",
    args: [designId],
  });
  return Number(rows[0]?.files);
}

// Board data a few bytes under the cap, so any real addition crosses it.
function nearlyFullBoardData(extra: Record<string, unknown> = {}) {
  const base = { visualEditBoard: true, ...extra, filler: "" };
  const room =
    VISUAL_EDIT_BOARD_MAX_DATA_BYTES - Buffer.byteLength(JSON.stringify(base));
  return { ...base, filler: "x".repeat(room - 8) };
}

async function designRow(id: string) {
  const { rows } = await exec.execute({
    sql: "SELECT owner_email, org_id, visibility, data FROM designs WHERE id = ?",
    args: [id],
  });
  return rows[0] as {
    owner_email: string;
    org_id: string | null;
    visibility: string;
    data: string;
  };
}

async function asPrincipal(designId: string, run: () => unknown) {
  return runWithRequestContext(
    {
      userEmail: PRINCIPAL,
      authCapability: `capability:visual-edit:design:${encodeURIComponent(designId)}`,
    },
    run,
  );
}

// The action route runs a capability call with no account identity.
async function asCapabilityOnly(designId: string, run: () => unknown) {
  return runWithRequestContext(
    {
      authCapability: `capability:visual-edit:design:${encodeURIComponent(designId)}`,
    },
    run,
  );
}

async function asUser(userEmail: string, run: () => unknown) {
  return runWithRequestContext({ userEmail }, run);
}

function claim(userEmail: string, designId: string, claimSecret: string) {
  return asUser(userEmail, () =>
    claimAction.run({ designId, claimSecret }, frontend),
  );
}

function issue(designId: string) {
  return runWithRequestContext({ userEmail: PRINCIPAL }, () =>
    issueVisualEditBoardClaim(designId),
  ) as Promise<string>;
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");
  exec = await bootDesignDatabase();
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("signed-out board writes", () => {
  it("writes the capability's own board", async () => {
    await seedBoard("own-board");
    await asPrincipal("own-board", () =>
      updateFile.run(
        { id: "own-board:board", content: "<html><body>notes</body></html>" },
        frontend,
      ),
    );
    const { rows } = await exec.execute({
      sql: "SELECT content FROM design_files WHERE id = ?",
      args: ["own-board:board"],
    });
    expect(rows[0]?.content).toContain("notes");
  });

  it("refuses a file on another board the shared principal also owns", async () => {
    await seedBoard("board-a");
    await seedBoard("board-b");
    await expect(
      asPrincipal("board-a", () =>
        updateFile.run(
          { id: "board-b:board", content: "<html><body>x</body></html>" },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    const { rows } = await exec.execute({
      sql: "SELECT content FROM design_files WHERE id = ?",
      args: ["board-b:board"],
    });
    expect(rows[0]?.content).toBe("<html><body></body></html>");
    await expect(
      asPrincipal("board-a", () =>
        createFile.run(
          { designId: "board-b", filename: "x.html", content: "<p>x</p>" },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "visual_edit_capability_design_mismatch",
    });
  });

  it("writes and reads its own private board with no account identity", async () => {
    await seedBoard("anonymous-board");
    expect((await designRow("anonymous-board")).visibility).toBe("private");
    await asCapabilityOnly("anonymous-board", () =>
      updateFile.run(
        {
          id: "anonymous-board:board",
          content: "<html><body>anon</body></html>",
        },
        frontend,
      ),
    );
    const read = (await asCapabilityOnly("anonymous-board", () =>
      getDesign.run({ id: "anonymous-board" }, frontend),
    )) as { files?: Array<{ content?: string }> };
    expect(read.files?.[0]?.content).toContain("anon");
  });

  it("hides a private board from a stranger and from another board's capability", async () => {
    await seedBoard("hidden-board");
    await expect(
      runWithRequestContext({}, () =>
        getDesign.run({ id: "hidden-board" }, frontend),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      asUser(BOB, () => getDesign.run({ id: "hidden-board" }, frontend)),
    ).rejects.toMatchObject({ statusCode: 404 });
    await seedBoard("other-board");
    await expect(
      asCapabilityOnly("other-board", () =>
        getDesign.run({ id: "hidden-board" }, frontend),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("caps a signed-out board file's size", async () => {
    await seedBoard("big-board");
    await expect(
      asPrincipal("big-board", () =>
        createFile.run(
          {
            designId: "big-board",
            filename: "big.html",
            content: "x".repeat(VISUAL_EDIT_BOARD_MAX_FILE_BYTES + 1),
          },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_board_file_too_large" });
  });
});

describe("signed-out board limits", () => {
  it("never lets concurrent creates push a board past its file cap", async () => {
    await seedBoard("full-board");
    for (let index = 2; index < VISUAL_EDIT_BOARD_MAX_FILES; index += 1) {
      await exec.execute({
        sql: "INSERT INTO design_files (id, design_id, filename, file_type, content) VALUES (?, ?, ?, ?, ?)",
        args: [
          `full-board:${index}`,
          "full-board",
          `screen-${index}.html`,
          "html",
          "<p>screen</p>",
        ],
      });
    }
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) =>
        asCapabilityOnly("full-board", () =>
          createFile.run(
            {
              designId: "full-board",
              filename: `race-${index}.html`,
              content: "<p>race</p>",
            },
            frontend,
          ),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect((result as PromiseRejectedResult).reason).toMatchObject({
        errorCode: "visual_edit_board_file_limit",
      });
    }
    const { rows } = await exec.execute({
      sql: "SELECT COUNT(*) AS files FROM design_files WHERE design_id = ?",
      args: ["full-board"],
    });
    expect(Number(rows[0]?.files)).toBe(VISUAL_EDIT_BOARD_MAX_FILES);
  });

  it("checks a content patch by the file it produces", async () => {
    await seedBoard("patched-board");
    const base = `<html><body>${"x".repeat(VISUAL_EDIT_BOARD_MAX_FILE_BYTES - 64)}</body></html>`;
    await exec.execute({
      sql: "UPDATE design_files SET content = ? WHERE id = ?",
      args: [base, "patched-board:board"],
    });
    const next = base.replace("<body>", `<body>${"y".repeat(128)}`);
    const contentPatch = sourceContentPatch(base, next);
    expect(contentPatch.text.length).toBeLessThan(256);
    await expect(
      asCapabilityOnly("patched-board", () =>
        updateFile.run(
          {
            id: "patched-board:board",
            contentPatch,
            expectedVersionHash: sourceContentHash(base),
          },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_board_file_too_large" });
    const { rows } = await exec.execute({
      sql: "SELECT content FROM design_files WHERE id = ?",
      args: ["patched-board:board"],
    });
    expect(rows[0]?.content).toBe(base);
  });

  it("caps each rename content override at the board file size", async () => {
    await seedBoard("renamed-board");
    const current = "<html><body></body></html>";
    await expect(
      asCapabilityOnly("renamed-board", () =>
        renameScreen.run(
          {
            id: "renamed-board:board",
            name: "Notes",
            contentOverrides: [
              {
                fileId: "renamed-board:board",
                content: "x".repeat(VISUAL_EDIT_BOARD_MAX_FILE_BYTES + 1),
                expectedVersionHash: sourceContentHash(current),
              },
            ],
          },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_board_file_too_large" });
    const { rows } = await exec.execute({
      sql: "SELECT filename, content FROM design_files WHERE id = ?",
      args: ["renamed-board:board"],
    });
    expect(rows[0]).toMatchObject({
      filename: "__board__.html",
      content: current,
    });
  });

  it("caps the design data a board capability stores, however it is written", async () => {
    await seedBoard("data-board");
    const half = "x".repeat(VISUAL_EDIT_BOARD_MAX_DATA_BYTES / 2 + 16);
    await asCapabilityOnly("data-board", () =>
      updateDesign.run(
        {
          id: "data-board",
          dataOperations: [{ op: "set", path: ["a"], value: half }],
        },
        frontend,
      ),
    );
    // Each operation is under the cap; the data it would leave is not.
    await expect(
      asCapabilityOnly("data-board", () =>
        updateDesign.run(
          {
            id: "data-board",
            dataOperations: [{ op: "set", path: ["b"], value: half }],
          },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_board_data_too_large" });
    await expect(
      asCapabilityOnly("data-board", () =>
        updateDesign.run(
          { id: "data-board", data: JSON.stringify({ b: half }) },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_board_data_too_large" });
    const stored = JSON.parse((await designRow("data-board")).data) as Record<
      string,
      unknown
    >;
    expect(stored.a).toBe(half);
    expect(stored.b).toBeUndefined();
    // An account write is not a board capability write and keeps its limits.
    await asUser(PRINCIPAL, () =>
      updateDesign.run(
        { id: "data-board", data: JSON.stringify({ b: half }) },
        frontend,
      ),
    );
  });
});

describe("claim-visual-edit-board", () => {
  it("stores only a hash of the claim secret", async () => {
    await seedBoard("hashed-board");
    const secret = await issue("hashed-board");
    const stored = await getSetting(
      "design-visual-edit-board-claim:hashed-board",
    );
    expect(secret.length).toBeGreaterThanOrEqual(40);
    expect(JSON.stringify(stored)).not.toContain(secret);
  });

  it("moves the board into the caller's account as a private design without bridge credentials", async () => {
    await seedBoard("claimed-board", PRINCIPAL, {
      visualEditBoard: true,
      screenMetadata: {
        home: {
          previewToken: "example-preview-token",
          bridgeToken: "example-bridge-token",
        },
      },
    });
    const secret = await issue("claimed-board");
    await expect(claim(ALICE, "claimed-board", secret)).resolves.toEqual({
      designId: "claimed-board",
      claimed: true,
      alreadyOwned: false,
    });
    const row = await designRow("claimed-board");
    expect(row.owner_email).toBe(ALICE);
    expect(row.visibility).toBe("private");
    expect(row.data).not.toContain("example-preview-token");
    expect(row.data).not.toContain("example-bridge-token");

    // The same user again is a no-op; the secret is spent for everyone else.
    await expect(claim(ALICE, "claimed-board", secret)).resolves.toMatchObject({
      alreadyOwned: true,
    });
    await expect(claim(BOB, "claimed-board", secret)).rejects.toMatchObject({
      errorCode: "visual_edit_board_not_claimable",
    });
    expect((await designRow("claimed-board")).owner_email).toBe(ALICE);
  });

  it("refuses a wrong secret and leaves the right one usable", async () => {
    await seedBoard("guessed-board");
    const secret = await issue("guessed-board");
    await expect(
      claim(BOB, "guessed-board", "x".repeat(43)),
    ).rejects.toMatchObject({ errorCode: "visual_edit_board_not_claimable" });
    expect((await designRow("guessed-board")).owner_email).toBe(PRINCIPAL);
    await expect(claim(ALICE, "guessed-board", secret)).resolves.toMatchObject({
      claimed: true,
    });
  });

  it("refuses a board an account already owns, even with a stored secret", async () => {
    await seedBoard("owned-board");
    const secret = await issue("owned-board");
    await exec.execute({
      sql: "UPDATE designs SET owner_email = ? WHERE id = ?",
      args: [BOB, "owned-board"],
    });
    await expect(claim(ALICE, "owned-board", secret)).rejects.toMatchObject({
      errorCode: "visual_edit_board_not_claimable",
    });
    expect((await designRow("owned-board")).owner_email).toBe(BOB);
  });

  it("gives a board to exactly one of two racing claims", async () => {
    await seedBoard("raced-board");
    const secret = await issue("raced-board");
    const results = await Promise.allSettled([
      claim(ALICE, "raced-board", secret),
      claim(BOB, "raced-board", secret),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const owner = (await designRow("raced-board")).owner_email;
    expect([ALICE, BOB]).toContain(owner);
  });

  it("lets two racing claims by the same account both succeed on one board", async () => {
    await seedBoard("same-user-race");
    const secret = await issue("same-user-race");
    const results = await Promise.all([
      claim(ALICE, "same-user-race", secret),
      claim(ALICE, "same-user-race", secret),
    ]);
    expect(results.map((r) => (r as { claimed: boolean }).claimed)).toEqual([
      true,
      true,
    ]);
    expect(
      results.filter((r) => !(r as { alreadyOwned: boolean }).alreadyOwned),
    ).toHaveLength(1);
    expect((await designRow("same-user-race")).owner_email).toBe(ALICE);
  });

  it("refuses a claim from the signed-out principal itself", async () => {
    await seedBoard("self-board");
    const secret = await issue("self-board");
    await expect(
      runWithRequestContext({ userEmail: PRINCIPAL }, () =>
        claimVisualEditBoard({
          designId: "self-board",
          claimSecret: secret,
          userEmail: PRINCIPAL,
          orgId: null,
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "visual_edit_board_claim_requires_account",
    });
  });
});

describe("claimed boards", () => {
  it("stops accepting a capability issued before the claim, for reads and writes", async () => {
    await seedBoard("revoked-board");
    const secret = await issue("revoked-board");
    await asCapabilityOnly("revoked-board", () =>
      updateFile.run(
        {
          id: "revoked-board:board",
          content: "<html><body>before claim</body></html>",
        },
        frontend,
      ),
    );
    await claim(ALICE, "revoked-board", secret);

    for (const as of [asCapabilityOnly, asPrincipal]) {
      await expect(
        as("revoked-board", () =>
          getDesign.run({ id: "revoked-board" }, frontend),
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        as("revoked-board", () =>
          updateFile.run(
            {
              id: "revoked-board:board",
              content: "<html><body>replayed</body></html>",
            },
            frontend,
          ),
        ),
      ).rejects.toBeTruthy();
      await expect(
        as("revoked-board", () =>
          updateDesign.run(
            {
              id: "revoked-board",
              dataOperations: [{ op: "set", path: ["x"], value: 1 }],
            },
            frontend,
          ),
        ),
      ).rejects.toBeTruthy();
    }

    await asUser(ALICE, () =>
      updateFile.run(
        {
          id: "revoked-board:board",
          content: "<html><body>owner edit</body></html>",
        },
        frontend,
      ),
    );
    const read = (await asUser(ALICE, () =>
      getDesign.run({ id: "revoked-board" }, frontend),
    )) as { files?: Array<{ content?: string }> };
    expect(read.files?.[0]?.content).toContain("owner edit");
  });

  it("keeps a claimed localhost board's old capability read-only after its owner makes it public", async () => {
    await seedBoard(
      "revoked-localhost",
      PRINCIPAL,
      { sourceType: "localhost", visualEditBoard: true },
      "public",
    );
    const secret = await issue("revoked-localhost");
    await claim(ALICE, "revoked-localhost", secret);
    await exec.execute({
      sql: "UPDATE designs SET visibility = 'public' WHERE id = ?",
      args: ["revoked-localhost"],
    });

    await asCapabilityOnly("revoked-localhost", () =>
      getDesign.run({ id: "revoked-localhost" }, frontend),
    );
    await expect(
      asCapabilityOnly("revoked-localhost", () =>
        updateFile.run(
          {
            id: "revoked-localhost:board",
            content: "<html><body>replayed</body></html>",
          },
          frontend,
        ),
      ),
    ).rejects.toBeTruthy();
    const { rows } = await exec.execute({
      sql: "SELECT content FROM design_files WHERE id = ?",
      args: ["revoked-localhost:board"],
    });
    expect(rows[0]?.content).not.toContain("replayed");
  });
});

describe("board connections", () => {
  beforeAll(async () => {
    await seedConnection("conn-a", 5101);
    await seedConnection("conn-b", 5102);
    await seedBoard("linked-a", PRINCIPAL, {
      sourceType: "localhost",
      visualEditBoard: true,
      connectionId: "conn-a",
    });
    await seedBoard("linked-b", PRINCIPAL, {
      sourceType: "localhost",
      visualEditBoard: true,
      connectionId: "conn-b",
    });
    await seedBoard("bridgeless");
    await linkVisualEditBoardConnections("linked-a", ["conn-a"]);
    await linkVisualEditBoardConnections("linked-b", ["conn-b"]);
  });

  it("lists only the board's own linked connection", async () => {
    const own = (await asCapabilityOnly("linked-a", () =>
      listLocalhostConnections.run({ designId: "linked-a" }, frontend),
    )) as { connections: Array<{ id: string }> };
    expect(own.connections.map((c) => c.id)).toEqual(["conn-a"]);
    const other = (await asCapabilityOnly("linked-a", () =>
      listLocalhostConnections.run(
        { designId: "linked-a", id: "conn-b" },
        frontend,
      ),
    )) as { connections: unknown[] };
    expect(other.connections).toEqual([]);
    const none = (await asCapabilityOnly("bridgeless", () =>
      listLocalhostConnections.run({ designId: "bridgeless" }, frontend),
    )) as { connections: unknown[] };
    expect(none.connections).toEqual([]);
  });

  it("refuses another board's connection for bridge, screen and data writes", async () => {
    await expect(
      asCapabilityOnly("linked-a", () =>
        readLocalFile.run(
          { designId: "linked-a", connectionId: "conn-b", path: "src/a.ts" },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_connection_not_linked" });
    await expect(
      asCapabilityOnly("linked-a", () =>
        addLocalhostScreens.run(
          { designId: "linked-a", connectionId: "conn-b", paths: ["/"] },
          frontend,
        ),
      ),
    ).rejects.toThrow(/No localhost connection/);
    await expect(
      asCapabilityOnly("bridgeless", () =>
        addLocalhostScreens.run(
          { designId: "bridgeless", paths: ["/"] },
          frontend,
        ),
      ),
    ).rejects.toThrow(/No localhost connection/);
    // The capability can write its board's data, so it could otherwise name
    // conn-b there and have later actions treat it as the board's own.
    await expect(
      asCapabilityOnly("linked-a", () =>
        updateDesign.run(
          {
            id: "linked-a",
            dataOperations: [
              { op: "set", path: ["connectionId"], value: "conn-b" },
            ],
          },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_connection_not_linked" });
    expect(JSON.parse((await designRow("linked-a")).data).connectionId).toBe(
      "conn-a",
    );
    expect(await fileCount("linked-a")).toBe(1);
  });

  it("uses the board's own connection", async () => {
    await asCapabilityOnly("linked-a", () =>
      addLocalhostScreens.run(
        { designId: "linked-a", connectionId: "conn-a", paths: ["/"] },
        frontend,
      ),
    );
    expect(await fileCount("linked-a")).toBe(2);
  });
});

describe("caps on every board writer", () => {
  it("caps the data add-breakpoint, apply-tweaks and the board migration leave", async () => {
    versions.skipSnapshots = true;
    await seedBoard("full-data", PRINCIPAL, nearlyFullBoardData());
    await exec.execute({
      sql: "DELETE FROM design_files WHERE design_id = ?",
      args: ["full-data"],
    });
    const before = (await designRow("full-data")).data;
    await expect(
      asCapabilityOnly("full-data", () =>
        addBreakpoint.run(
          { designId: "full-data", label: "Tablet", widthPx: 768 },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_board_data_too_large" });
    await expect(
      asCapabilityOnly("full-data", () =>
        applyTweaks.run(
          { designId: "full-data", selections: { "theme-accent": "#0EA5E9" } },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_board_data_too_large" });
    await expect(
      asCapabilityOnly("full-data", () =>
        migrateBoardObjectsToFile.run({ designId: "full-data" }, frontend),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_board_data_too_large" });
    expect((await designRow("full-data")).data).toBe(before);
    versions.skipSnapshots = false;
  });

  it("applies the file cap inside screen and board-file insertion", async () => {
    await seedConnection("conn-full", 5103);
    await seedBoard("full-files", PRINCIPAL, {
      sourceType: "localhost",
      visualEditBoard: true,
      connectionId: "conn-full",
    });
    await linkVisualEditBoardConnections("full-files", ["conn-full"]);
    await fillBoard("full-files", VISUAL_EDIT_BOARD_MAX_FILES - 1);
    await expect(
      asCapabilityOnly("full-files", () =>
        addLocalhostScreens.run(
          { designId: "full-files", connectionId: "conn-full", paths: ["/"] },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_board_file_limit" });

    await seedBoard("full-migration");
    await exec.execute({
      sql: "DELETE FROM design_files WHERE design_id = ?",
      args: ["full-migration"],
    });
    await fillBoard("full-migration", VISUAL_EDIT_BOARD_MAX_FILES);
    await expect(
      asCapabilityOnly("full-migration", () =>
        migrateBoardObjectsToFile.run({ designId: "full-migration" }, frontend),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_board_file_limit" });
    expect(await fileCount("full-files")).toBe(VISUAL_EDIT_BOARD_MAX_FILES);
    expect(await fileCount("full-migration")).toBe(VISUAL_EDIT_BOARD_MAX_FILES);
  });

  it("caps a screen snapshot update-screen-source would store", async () => {
    await seedConnection("conn-snap", 5104);
    await seedBoard("snapshot-board", PRINCIPAL, {
      sourceType: "localhost",
      visualEditBoard: true,
      connectionId: "conn-snap",
      screenMetadata: {
        "snapshot-board:board": {
          sourceType: "url",
          url: "http://localhost:5104/",
          connectionId: "conn-snap",
        },
      },
    });
    await linkVisualEditBoardConnections("snapshot-board", ["conn-snap"]);
    await exec.execute({
      sql: "UPDATE design_files SET content = ? WHERE id = ?",
      args: ["http://localhost:5104/", "snapshot-board:board"],
    });
    await expect(
      asCapabilityOnly("snapshot-board", () =>
        updateScreenSource.run(
          {
            designId: "snapshot-board",
            fileId: "snapshot-board:board",
            sourceType: "static",
            snapshotHtml: `<div>${"x".repeat(VISUAL_EDIT_BOARD_MAX_FILE_BYTES)}</div>`,
          },
          frontend,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_board_file_too_large" });
    const { rows } = await exec.execute({
      sql: "SELECT content FROM design_files WHERE id = ?",
      args: ["snapshot-board:board"],
    });
    expect(rows[0]?.content).toBe("http://localhost:5104/");
  });
});
