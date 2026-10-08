// Copies a real Design design so a clip can be reproduced on the same content
// without touching the original.
//
//   node .agents/skills/design-clip-repro/scripts/copy-design.mjs <design id or URL> [--from test-account|db]
//   node .agents/skills/design-clip-repro/scripts/copy-design.mjs --delete-prod-copy <id>
//
// Where the design is read from:
// - the test account (DESIGN_TEST_EMAIL / DESIGN_TEST_PASSWORD) on the deployed
//   Design app, when the design is shared with it;
// - otherwise a read-only database URL in CLIP_REPRO_PROD_DESIGN_DB_URL. This
//   script only SELECTs. Never name that variable DATABASE_URL or
//   DESIGN_DATABASE_URL: the Design app connects to those.
//
// What it creates:
// - a copy on the deployed app owned by the test account (the unfixed build,
//   where the bug is reproduced), made through Design's own API;
// - a local copy in this checkout's Design app (where the fix runs).
// The source is saved under templates/design/.tmp/parity/design-<id>/.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import { action, api } from "../harness/dlib.mjs";
import {
  BASE,
  PROD_BASE,
  TEST_ACCOUNT,
  WORKTREE,
} from "../harness/harness-env.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const DB_URL = process.env.CLIP_REPRO_PROD_DESIGN_DB_URL;
const COPY_PREFIX = "Clip repro: ";

const toDelete = flag("--delete-prod-copy");
if (toDelete) {
  if (!TEST_ACCOUNT) {
    console.error("DESIGN_TEST_EMAIL / DESIGN_TEST_PASSWORD are not set.");
    process.exit(3);
  }
  const prod = await api(PROD_BASE, TEST_ACCOUNT);
  const target = await action(prod, "get-design", { id: toDelete }, "GET");
  if (!target?.title?.startsWith(COPY_PREFIX)) {
    console.error(
      `${toDelete} is not a copy made by this script (its title does not start with "${COPY_PREFIX}"); not deleting it.`,
    );
    process.exit(4);
  }
  await action(prod, "delete-design", { id: toDelete });
  console.log(`deleted production copy ${toDelete}`);
  process.exit(0);
}

const from = flag("--from");
const input = args[0];
if (!input) {
  console.error(
    "usage: copy-design.mjs <design id or URL> [--from test-account|db]",
  );
  process.exit(2);
}
const sourceId = input.match(/\/design\/([A-Za-z0-9_-]+)/)?.[1] ?? input;
if (!/^[A-Za-z0-9_-]+$/.test(sourceId)) {
  console.error(`not a design id or design URL: ${input}`);
  process.exit(2);
}
if (!TEST_ACCOUNT && !DB_URL) {
  console.error(
    "Neither DESIGN_TEST_EMAIL / DESIGN_TEST_PASSWORD nor CLIP_REPRO_PROD_DESIGN_DB_URL is set. Ask the user.",
  );
  process.exit(3);
}

const parseData = (data) =>
  typeof data === "string" ? JSON.parse(data || "{}") : (data ?? {});

/** Recreates `design` through Design's API as whoever `ctx` is logged in as, with the original screen geometry. */
async function importDesign(ctx, design) {
  const created = await action(ctx, "create-design", {
    title: `${COPY_PREFIX}${design.title}`,
    projectType: design.projectType ?? "prototype",
    designSystemId: null,
  });
  const fileIds = new Map();
  for (const file of design.files) {
    const made = await action(ctx, "create-file", {
      designId: created.id,
      filename: file.filename,
      content: file.content,
      fileType: file.fileType ?? "html",
    });
    fileIds.set(file.id, made.id);
  }
  // Screen geometry and metadata are keyed by file id, and other keys can
  // reference screens too, so every old id is rewritten before the data is set.
  let dataJson = JSON.stringify(parseData(design.data));
  for (const [oldId, newId] of fileIds)
    dataJson = dataJson.split(oldId).join(newId);
  const dataOperations = Object.entries(JSON.parse(dataJson)).map(
    ([key, value]) => ({
      op: "set",
      path: [key],
      value,
    }),
  );
  if (dataOperations.length > 0) {
    await action(ctx, "update-design", { id: created.id, dataOperations });
  }
  return created.id;
}

async function readFromDatabase() {
  const postgres = createRequire(`${WORKTREE}/packages/core/package.json`)(
    "postgres",
  );
  const sql = postgres(DB_URL, {
    max: 1,
    connection: { default_transaction_read_only: "on" },
  });
  try {
    const [row] = await sql`
      select id, title, description, data, project_type from designs where id = ${sourceId}`;
    if (!row) return null;
    const files = await sql`
      select id, filename, content, file_type from design_files where design_id = ${sourceId}`;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      projectType: row.project_type,
      data: row.data,
      files: files.map((f) => ({
        id: f.id,
        filename: f.filename,
        content: f.content,
        fileType: f.file_type,
      })),
    };
  } finally {
    await sql.end();
  }
}

const prod = TEST_ACCOUNT ? await api(PROD_BASE, TEST_ACCOUNT) : null;
let design = null;
let via = null;
let prodCopyId = null;
let testAccountError = null;

if (prod && from !== "db") {
  design = await action(prod, "get-design", { id: sourceId }, "GET").catch(
    (err) => {
      testAccountError = err.message;
      return null;
    },
  );
  if (design) {
    via = "test-account";
    ({ id: prodCopyId } = await action(prod, "duplicate-design", {
      id: sourceId,
      title: `${COPY_PREFIX}${design.title}`,
    }));
  }
}
if (!design && DB_URL && from !== "test-account") {
  design = await readFromDatabase();
  if (design) {
    via = "db";
    if (prod) prodCopyId = await importDesign(prod, design);
  }
}
if (!design) {
  const reasons = [
    testAccountError &&
      `the test account (${TEST_ACCOUNT.email}) cannot open it: ${testAccountError}`,
    DB_URL
      ? "it is not in that database"
      : "CLIP_REPRO_PROD_DESIGN_DB_URL is not set",
  ].filter(Boolean);
  console.error(
    `Could not copy design ${sourceId}: ${reasons.join("; ")}.\n` +
      `Ask the user for the right design id, or to share it with ${TEST_ACCOUNT?.email ?? "the test account"}.`,
  );
  process.exit(4);
}

const dir = `${WORKTREE}/templates/design/.tmp/parity/design-${sourceId}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/source.json`, JSON.stringify(design, null, 2));
if (prodCopyId) {
  console.log(
    `production copy ${prodCopyId} created; delete it when done: node ${process.argv[1]} --delete-prod-copy ${prodCopyId}`,
  );
}

const local = await api();
const localId = await importDesign(local, design);
await local.dispose();

const summary = {
  sourceId,
  title: design.title,
  files: design.files.length,
  via,
  prodCopyId,
  prodCopyUrl: prodCopyId
    ? `${PROD_BASE}/design/${prodCopyId}?editorView=overview`
    : null,
  localId,
  localUrl: `${BASE}/design/${localId}?editorView=overview`,
  source: `${dir}/source.json`,
};
writeFileSync(`${dir}/copy.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(
  prodCopyId
    ? `Reproduce the unfixed bug on the production copy (openEditor(prodCopyId, { prod: true })), fix and verify on the local copy. ` +
        `When done: node ${process.argv[1]} --delete-prod-copy ${prodCopyId}`
    : "No production copy (no test account). Reproduce on the local copy before changing any code.",
);
