import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { closeDbExec } from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "../server/db/index.js";
import { createProject } from "../server/model/projects-store.js";
import { startServer } from "./daily/server.js";
import { safeErrorDiagnostic } from "./failure-diagnostic.js";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.equal(database.protocol, "postgresql:");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.username, "qa_analytics2");
assert.equal(database.password, "");
assert.equal(database.pathname, "/qa_analytics2");
assert.ok(database.port);

const port = Number(
  process.argv.find((arg) => arg.startsWith("--port="))?.slice(7) ?? 18093,
);
const { server, child } = await startServer(0, true, port);
const headers = {
  cookie: server.cookie,
  "content-type": "application/json",
  "x-agent-native-frontend": "1",
  "x-agent-native-csrf": "1",
};
async function action(name: string, input: object, method = "POST") {
  const url = new URL(`${server.base}/_agent-native/actions/${name}`);
  if (method === "GET")
    for (const [key, value] of Object.entries(input))
      url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    method,
    headers,
    ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json() };
}
try {
  const shell = await action("get-workspace-shell", {}, "GET");
  assert.equal(shell.status, 200);
  assert.equal(shell.body.user.email, "qa-fleet@builder.io");
  const orgId: string = shell.body.workspace.id;
  assert.ok(orgId);
  console.log(`AUTH qa-fleet@builder.io isolated workspace=${orgId}`);
  const failures: unknown[] = [];
  for (const role of ["editor", "viewer"] as const) {
    try {
      const ownerEmail = "fixture-owner@example.invalid";
      const project = await createProject({
        ownerEmail,
        orgId,
        title: `Shared ${role} ${randomUUID()}`,
        cells: [
          {
            id: `cel_${randomUUID()}`,
            kind: "sql",
            source: "select * from orders limit 1",
            dataConnectionId: "builtin-sample-data",
            databaseSchema: null,
            resultVariable: "shared_rows",
            outputResult: true,
            label: null,
            hidden: false,
            gridX: null,
            gridY: null,
            gridWidth: null,
            gridHeight: null,
          },
        ],
      });
      const grantId = `shr_${randomUUID()}`;
      await getDb().insert(schema.projectShares).values({
        id: grantId,
        resourceId: project.id,
        principalType: "user",
        principalId: "qa-fleet@builder.io",
        role,
        createdBy: ownerEmail,
        createdAt: new Date().toISOString(),
      });
      const cell = project.cells[0]!;
      const source = "select * from orders limit 2";
      const title = `Renamed shared ${role}`;
      const statuses: number[] = [];
      for (const [name, input] of [
        [
          "save-project-cell",
          {
            projectId: project.id,
            cellId: cell.id,
            contents: { ...cell.contents, source },
          },
        ],
        ["update-project", { projectId: project.id, title }],
        ["run-project-cell", { projectId: project.id, cellId: cell.id }],
      ] as const) {
        const result = await action(name, input);
        statuses.push(result.status);
        console.log(`${role} ${name} HTTP ${result.status}`);
        if (result.status === 200 && name === "run-project-cell") {
          assert.equal(result.body.status, "complete");
          assert.equal(result.body.output.type, "table");
          assert.equal(result.body.output.rowCount, 2);
        }
      }
      if (role === "editor") assert.deepEqual(statuses, [200, 200, 200]);
      else
        for (const status of statuses) assert.ok([403, 404].includes(status));
      const runSettings = await action("set-notebook-run-settings", {
        projectId: project.id,
        expectedSettingsRevision: "0",
        defaultMode: "upstream",
      });
      assert.equal(runSettings.status, 200);
      if (role === "editor") {
        assert.equal(runSettings.body.status, "saved");
        assert.equal(runSettings.body.defaultMode, "upstream");
      } else {
        assert.equal(runSettings.body.status, "absent");
      }
      for (let reopen = 0; reopen < 2; reopen++) {
        const read = await action(
          "get-project",
          { projectId: project.id },
          "GET",
        );
        assert.equal(read.status, 200);
        assert.equal(read.body.canEdit, role === "editor");
        assert.equal(read.body.project.ownerEmail, ownerEmail);
        assert.equal(
          read.body.project.title,
          role === "editor" ? title : project.title,
        );
        assert.equal(
          read.body.project.cells[0].contents.source,
          role === "editor" ? source : "select * from orders limit 1",
        );
        if (role === "editor")
          assert.equal(read.body.outputs[cell.id].status, "complete");
        else assert.deepEqual(read.body.outputs, {});
      }
      for (const [name, input] of [
        ["trash-project", { projectId: project.id }],
        [
          "transfer-project-owner",
          { projectId: project.id, ownerEmail: "qa-fleet@builder.io" },
        ],
      ] as const) {
        const result = await action(name, input);
        assert.ok([403, 404].includes(result.status), `${role} ${name} denied`);
      }
      if (role === "editor") {
        await getDb()
          .update(schema.projectShares)
          .set({ role: "viewer" })
          .where(eq(schema.projectShares.id, grantId));
        const revoked = await action("save-project-cell", {
          projectId: project.id,
          cellId: cell.id,
          contents: {
            ...cell.contents,
            source: "select * from orders limit 3",
          },
        });
        assert.ok([403, 404].includes(revoked.status));
        const read = await action(
          "get-project",
          { projectId: project.id },
          "GET",
        );
        assert.equal(read.body.canEdit, false);
        assert.equal(read.body.project.cells[0].contents.source, source);
      }
      console.log(
        `PASS ${role} save/run/rename, durable readback, owner boundaries${role === "editor" ? ", revocation" : ""}`,
      );
    } catch (error) {
      failures.push(error);
      console.error(`FAIL ${role}: ${safeErrorDiagnostic(error)}`);
    }
  }
  assert.equal(failures.length, 0, "Shared editor storage matrix failed");
} finally {
  await closeDbExec();
  if (child && child.exitCode === null) {
    const exited = new Promise((done) => child.once("exit", done));
    child.kill("SIGTERM");
    await exited;
  }
}
