#!/usr/bin/env node
// Seeds one wide Content collection through the public action surface, shaped
// like a real priorities tracker: a few hundred rows, a dozen properties with
// several long text values, status/select/date/number/relation columns, row
// bodies with stored block identities, and saved views that sort and filter.
// Progress is written to a manifest so an interrupted run resumes instead of
// duplicating rows.
//
//   node scripts/seed-perf-database.mjs --base-url http://127.0.0.1:8080 \
//     --email perf-owner@example.local --password '...' \
//     [--rows 230] [--title "Perf Task Priorities"] [--concurrency 6]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const next = process.argv[i + 1];
  if (next !== undefined && !next.startsWith("--")) {
    args.set(arg.slice(2), next);
    i += 1;
  } else {
    args.set(arg.slice(2), "true");
  }
}

function required(name) {
  const value = args.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

const baseUrl = required("base-url").replace(/\/+$/, "");
const email = required("email");
const password = required("password");
const rowCount = Number(args.get("rows") ?? 230);
const title = args.get("title") ?? "Perf Task Priorities";
const concurrency = Math.max(1, Number(args.get("concurrency") ?? 6));
const allowRegister = args.get("register") !== "false";
const manifestPath = resolve(
  args.get("manifest") ??
    `.tmp/perf-database-${new URL(baseUrl).host.replace(/[^a-z0-9.-]/gi, "_")}-${email.replace(/[^a-z0-9]/gi, "_")}-${title.replace(/[^a-z0-9]/gi, "_")}.json`,
);

// Deterministic generator so reruns produce the same fixture shape.
let seed = 0x7a5c;
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}
function pick(values) {
  return values[Math.floor(random() * values.length)];
}

const WORDS =
  "follow up with the team about launch plan review draft schedule call confirm budget numbers send notes share update customer feedback check invoice renew contract book travel outline proposal finish migration test rollout write summary prepare agenda unblock hiring decision collect quotes compare vendors pick date reply thread".split(
    " ",
  );

function sentence(min = 8, max = 18) {
  const length = min + Math.floor(random() * (max - min));
  const words = Array.from({ length }, () => pick(WORDS));
  words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return `${words.join(" ")}.`;
}

// Long text cells like "Next action" and "Waiting on": 150-300 characters.
function longText() {
  const target = 150 + Math.floor(random() * 150);
  let text = sentence();
  while (text.length < target) text += ` ${sentence()}`;
  return text
    .slice(0, target)
    .replace(/\s+\S*$/, "")
    .concat(".");
}

function rowBody() {
  const parts = [`## ${sentence(3, 6).replace(/\.$/, "")}`];
  const paragraphs = 2 + Math.floor(random() * 4);
  for (let p = 0; p < paragraphs; p += 1) {
    parts.push(Array.from({ length: 3 }, () => sentence()).join(" "));
  }
  parts.push(
    Array.from(
      { length: 2 + Math.floor(random() * 3) },
      () => `- ${sentence(4, 9)}`,
    ).join("\n"),
  );
  parts.push(sentence(10, 20));
  return parts.join("\n\n");
}

function isoDay(offsetDays) {
  const date = new Date(Date.UTC(2026, 8, 1) + offsetDays * 86_400_000);
  return date.toISOString().slice(0, 10);
}

const STATUS_OPTIONS = [
  { id: "not-started", name: "Not started", color: "gray" },
  { id: "in-progress", name: "In progress", color: "blue" },
  { id: "waiting", name: "Waiting", color: "yellow" },
  { id: "done", name: "Done", color: "green" },
];
const AREA_OPTIONS = [
  { id: "personal", name: "Personal", color: "purple" },
  { id: "builder", name: "Builder", color: "blue" },
  { id: "parasail", name: "Parasail", color: "orange" },
  { id: "home", name: "Home", color: "green" },
];
const PRIORITY_OPTIONS = [
  { id: "p0", name: "P0", color: "red" },
  { id: "p1", name: "P1", color: "orange" },
  { id: "p2", name: "P2", color: "yellow" },
  { id: "p3", name: "P3", color: "gray" },
];
const TAG_OPTIONS = [
  { id: "email", name: "Email", color: "blue" },
  { id: "call", name: "Call", color: "green" },
  { id: "writing", name: "Writing", color: "purple" },
  { id: "errand", name: "Errand", color: "orange" },
  { id: "deep-work", name: "Deep work", color: "red" },
];

// Property order is the column order a new table shows.
const PROPERTY_PLAN = [
  { key: "rank", name: "Rank", type: "number" },
  {
    key: "status",
    name: "Status",
    type: "status",
    options: { options: STATUS_OPTIONS },
  },
  {
    key: "area",
    name: "Area",
    type: "select",
    options: { options: AREA_OPTIONS },
  },
  {
    key: "priority",
    name: "Priority",
    type: "select",
    options: { options: PRIORITY_OPTIONS },
  },
  { key: "nextAction", name: "Next action", type: "text" },
  { key: "waitingOn", name: "Waiting on", type: "text" },
  { key: "notes", name: "Notes", type: "text" },
  { key: "due", name: "Due", type: "date" },
  { key: "lastTouched", name: "Last touched", type: "date" },
  { key: "effort", name: "Effort", type: "number" },
  {
    key: "tags",
    name: "Tags",
    type: "multi_select",
    options: { options: TAG_OPTIONS },
  },
  { key: "link", name: "Link", type: "url" },
  { key: "blockedBy", name: "Blocked by", type: "relation", relation: true },
];

function rowValues(index, propertyIds) {
  const status =
    index % 7 === 0
      ? "done"
      : index % 5 === 0
        ? "waiting"
        : index % 3 === 0
          ? "in-progress"
          : "not-started";
  const values = {
    [propertyIds.rank]: index + 1,
    [propertyIds.status]: status,
    [propertyIds.area]: AREA_OPTIONS[index % AREA_OPTIONS.length].id,
    [propertyIds.priority]: pick(PRIORITY_OPTIONS).id,
    [propertyIds.nextAction]: longText(),
    [propertyIds.notes]: longText(),
    [propertyIds.due]: { start: isoDay(index % 90), includeTime: false },
    [propertyIds.lastTouched]: {
      start: isoDay(-(index % 30)),
      includeTime: false,
    },
    [propertyIds.effort]: 1 + Math.floor(random() * 8),
    [propertyIds.tags]: TAG_OPTIONS.filter(() => random() < 0.35).map(
      (option) => option.id,
    ),
    [propertyIds.link]: `https://example.com/tasks/${index + 1}`,
  };
  if (status === "waiting" || index % 4 === 0) {
    values[propertyIds.waitingOn] = longText();
  }
  return values;
}

function loadManifest() {
  if (!existsSync(manifestPath)) {
    return { properties: {}, rows: [], bodies: [], relations: [] };
  }
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function saveManifest(manifest) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function signIn(accountEmail, accountPassword) {
  const post = (path, payload) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify(payload),
      redirect: "manual",
    });
  let response = await post("/_agent-native/auth/login", {
    email: accountEmail,
    password: accountPassword,
  });
  if (!response.ok && allowRegister) {
    await post("/_agent-native/auth/register", {
      email: accountEmail,
      password: accountPassword,
      name: accountEmail.split("@")[0],
      callbackURL: "/",
    });
    response = await post("/_agent-native/auth/login", {
      email: accountEmail,
      password: accountPassword,
    });
  }
  if (!response.ok) {
    throw new Error(
      `Sign-in failed for ${accountEmail} (${response.status}): ${await response.text()}`,
    );
  }
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean);
  if (cookies.length === 0) {
    throw new Error(`Sign-in for ${accountEmail} returned no session cookie`);
  }
  const cookie = cookies.join("; ");
  const completed = await fetch(
    `${baseUrl}/_agent-native/onboarding/first-run/complete`,
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl, cookie },
      body: "{}",
    },
  );
  if (!completed.ok) {
    throw new Error(
      `Completing first-run onboarding failed for ${accountEmail} (${completed.status})`,
    );
  }
  return cookie;
}

async function callAction(cookie, name, payload, attempt = 1) {
  const response = await fetch(`${baseUrl}/_agent-native/actions/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie,
    },
    body: JSON.stringify(payload),
  });
  if (response.ok) return response.json();
  const text = await response.text();
  const retryable = response.status === 429 || response.status >= 500;
  if (retryable && attempt < 5) {
    await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
    return callAction(cookie, name, payload, attempt + 1);
  }
  throw new Error(`${name} failed (${response.status}): ${text.slice(0, 400)}`);
}

async function readAction(cookie, name, params) {
  const url = new URL(`${baseUrl}/_agent-native/actions/${name}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  const response = await fetch(url, { headers: { cookie, origin: baseUrl } });
  if (!response.ok) {
    throw new Error(
      `${name} failed (${response.status}): ${(await response.text()).slice(0, 400)}`,
    );
  }
  return response.json();
}

async function runPool(items, label, worker) {
  let next = 0;
  let completed = 0;
  const started = Date.now();
  async function lane() {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
      completed += 1;
      if (completed % 50 === 0 || completed === items.length) {
        const rate = completed / ((Date.now() - started) / 1000);
        console.log(
          `[perf database] ${label} ${completed}/${items.length} (${rate.toFixed(1)}/s)`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, lane));
}

const manifest = loadManifest();
const cookie = await signIn(email, password);

if (!manifest.databaseId) {
  const spaces = await readAction(cookie, "list-content-spaces", {});
  const personal =
    spaces.spaces.find((space) => space.kind === "personal") ??
    spaces.spaces[0];
  const created = await callAction(cookie, "create-content-database", {
    spaceId: personal.id,
    title,
    idempotencyKey: `perf-database-${title}`,
  });
  const primary = created.properties.find(
    (property) =>
      property.definition.type === "blocks" &&
      property.definition.options?.blocks?.primary === true,
  );
  if (!primary) throw new Error("New collection has no primary Blocks field");
  manifest.spaceId = personal.id;
  manifest.databaseId = created.database.id;
  manifest.databaseDocumentId = created.database.documentId;
  manifest.primaryBlocksPropertyId = primary.definition.id;
  saveManifest(manifest);
}

const databaseId = manifest.databaseId;
const databaseDocumentId = manifest.databaseDocumentId;

for (const property of PROPERTY_PLAN) {
  if (manifest.properties[property.key]) continue;
  const response = await callAction(cookie, "configure-document-property", {
    documentId: databaseDocumentId,
    databaseId,
    name: property.name,
    type: property.type,
    ...(property.options ? { options: property.options } : {}),
    ...(property.relation ? { options: { relation: { databaseId } } } : {}),
  });
  const created = response.properties.find(
    (candidate) => candidate.definition.name === property.name,
  );
  if (!created) throw new Error(`Property "${property.name}" was not created`);
  manifest.properties[property.key] = created.definition.id;
  saveManifest(manifest);
}
const propertyIds = manifest.properties;

const contract = (
  await readAction(cookie, "get-content-database", { databaseId, limit: "0" })
).mutationContract;
if (!contract) throw new Error("Collection has no mutation contract");

const createdRows = new Map(manifest.rows.map((row) => [row.index, row]));
const pendingRows = Array.from(
  { length: rowCount },
  (_, index) => index,
).filter((index) => !createdRows.has(index));
// Values come from the deterministic generator, so draw them in row order
// before the pool interleaves requests.
const plannedRows = new Map(
  Array.from({ length: rowCount }, (_, index) => [
    index,
    {
      title: `${sentence(3, 7).replace(/\.$/, "")} #${index + 1}`,
      values: rowValues(index, propertyIds),
    },
  ]),
);
await runPool(pendingRows, "rows", async (index) => {
  const result = await callAction(cookie, "add-database-item", {
    target: contract.target,
    expectedSchemaRevision: contract.schemaRevision,
    idempotencyKey: `perf-row-${databaseId}-${index}`,
    title: plannedRows.get(index).title,
    propertyValues: plannedRows.get(index).values,
  });
  const row = {
    index,
    itemId: result.receipt.row.itemId,
    documentId: result.receipt.row.documentId,
  };
  createdRows.set(index, row);
  manifest.rows.push(row);
  if (manifest.rows.length % 25 === 0) saveManifest(manifest);
});
manifest.rows.sort((left, right) => left.index - right.index);
saveManifest(manifest);

const plannedBodies = new Map(
  manifest.rows.map((row) => [row.index, rowBody()]),
);
const doneBodies = new Set(manifest.bodies);
await runPool(
  manifest.rows.filter((row) => !doneBodies.has(row.index)),
  "bodies",
  async (row) => {
    await callAction(cookie, "set-document-property", {
      documentId: row.documentId,
      databaseId,
      propertyId: manifest.primaryBlocksPropertyId,
      value: plannedBodies.get(row.index),
    });
    manifest.bodies.push(row.index);
    if (manifest.bodies.length % 25 === 0) saveManifest(manifest);
  },
);
saveManifest(manifest);

// About a third of rows are blocked by one or two earlier rows.
const doneRelations = new Set(manifest.relations);
const relationRows = manifest.rows.filter(
  (row) => row.index > 2 && row.index % 3 === 1,
);
const plannedRelations = new Map(
  relationRows.map((row) => [
    row.index,
    Array.from(
      { length: 1 + (row.index % 2) },
      () => manifest.rows[Math.floor(random() * row.index)].documentId,
    ),
  ]),
);
await runPool(
  relationRows.filter((row) => !doneRelations.has(row.index)),
  "relations",
  async (row) => {
    await callAction(cookie, "set-document-property", {
      documentId: row.documentId,
      databaseId,
      propertyId: propertyIds.blockedBy,
      value: [...new Set(plannedRelations.get(row.index))],
    });
    manifest.relations.push(row.index);
    if (manifest.relations.length % 25 === 0) saveManifest(manifest);
  },
);
saveManifest(manifest);

if (!manifest.views) {
  const rankSort = [{ key: propertyIds.rank, label: "Rank", direction: "asc" }];
  const areaView = (id, name, areaId) => ({
    id,
    name,
    type: "table",
    sorts: rankSort,
    filters: [
      {
        key: propertyIds.area,
        label: "Area",
        operator: "equals",
        value: JSON.stringify([areaId]),
      },
    ],
    filterMode: "and",
  });
  await callAction(cookie, "update-content-database-view", {
    databaseId,
    viewConfig: {
      activeViewId: "all-up",
      views: [
        {
          id: "all-up",
          name: "All Up",
          type: "table",
          sorts: rankSort,
          filters: [
            {
              key: propertyIds.status,
              label: "Status",
              operator: "does_not_equal",
              value: JSON.stringify(["done"]),
            },
          ],
          filterMode: "and",
          wrapCells: true,
        },
        areaView("personal", "Personal", "personal"),
        areaView("builder", "Builder", "builder"),
        areaView("parasail", "Parasail", "parasail"),
      ],
    },
  });
  manifest.views = true;
  saveManifest(manifest);
}

console.log(
  JSON.stringify(
    {
      manifest: manifestPath,
      databaseId,
      databaseDocumentId,
      path: `/page/${databaseDocumentId}`,
      rows: manifest.rows.length,
      bodies: manifest.bodies.length,
      relations: manifest.relations.length,
      properties: Object.keys(propertyIds).length + 1,
    },
    null,
    2,
  ),
);
