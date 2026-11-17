import type { ActionRunContext } from "@agent-native/core/action";
import { closeDbExec, type DbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { getSetting } from "@agent-native/core/settings";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import claimAction from "../../actions/claim-visual-edit-board.js";
import createFile from "../../actions/create-file.js";
import updateFile from "../../actions/update-file.js";
import { LOCAL_VISUAL_EDIT_PRINCIPAL_DOMAIN } from "../../shared/local-visual-edit-principal.js";
import { bootDesignDatabase } from "./failed-write-test-harness.js";
import {
  claimVisualEditBoard,
  issueVisualEditBoardClaim,
} from "./visual-edit-board-claim.js";
import { VISUAL_EDIT_BOARD_MAX_FILE_BYTES } from "./visual-edit-capability.js";

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
) {
  await exec.execute({
    sql: "INSERT INTO designs (id, title, data, owner_email, visibility) VALUES (?, ?, ?, ?, ?)",
    args: [id, "Board", JSON.stringify(data), ownerEmail, "public"],
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

  it("writes its own public board with no account identity", async () => {
    await seedBoard("anonymous-board");
    await asCapabilityOnly("anonymous-board", () =>
      updateFile.run(
        {
          id: "anonymous-board:board",
          content: "<html><body>anon</body></html>",
        },
        frontend,
      ),
    );
    const { rows } = await exec.execute({
      sql: "SELECT content FROM design_files WHERE id = ?",
      args: ["anonymous-board:board"],
    });
    expect(rows[0]?.content).toContain("anon");
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
