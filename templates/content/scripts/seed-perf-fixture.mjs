#!/usr/bin/env node
// Seeds a large Content workspace through the public action surface, so the
// same fixture shape can be built on a local dev server or a hosted lane.
//
// The shape mirrors a real broad-and-shallow workspace: most pages at the Files
// root, a small nested population with one deep chain, a heavy-tailed body size
// distribution, internal page links, pages shared in from a second account, and
// a few inline databases. Progress is written to a manifest so an interrupted
// run resumes instead of duplicating pages.
//
//   node scripts/seed-perf-fixture.mjs --base-url http://127.0.0.1:8080 \
//     --email perf-owner@example.local --password '...' \
//     [--count 3000] [--shared 500 --share-email ... --share-password ...]
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
const total = Number(args.get("count") ?? 3000);
const sharedCount = Number(args.get("shared") ?? 0);
const shareEmail = args.get("share-email");
const sharePassword = args.get("share-password");
const concurrency = Math.max(1, Number(args.get("concurrency") ?? 6));
const prefix = args.get("prefix") ?? "Perf fixture";
const allowRegister = args.get("register") !== "false";
const manifestPath = resolve(
  args.get("manifest") ??
    `.tmp/perf-fixture-${new URL(baseUrl).host.replace(/[^a-z0-9.-]/gi, "_")}-${email.replace(/[^a-z0-9]/gi, "_")}-${total}.json`,
);

if (sharedCount > 0 && (!shareEmail || !sharePassword)) {
  throw new Error("--shared needs --share-email and --share-password");
}
if (sharedCount >= total) throw new Error("--shared must be below --count");

// Deterministic generator so reruns produce the same fixture shape.
let seed = 0x5eed;
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}

const WORDS =
  "workspace draft review launch roadmap customer signal metric pipeline agent editor sidebar query page collection property release outline decision research interview summary proposal budget timeline owner feedback latency cache session document folder archive template meeting notes".split(
    " ",
  );

function sentence(min = 8, max = 20) {
  const length = min + Math.floor(random() * (max - min));
  const words = Array.from(
    { length },
    () => WORDS[Math.floor(random() * WORDS.length)],
  );
  words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return `${words.join(" ")}.`;
}

// Heavy-tailed target sizes: about 4KB at p50 and 18KB at p90, with a few
// pages near 80KB like the longest real documents.
function targetBodyBytes(index) {
  if (index % 600 === 7) return 80_000 + Math.floor(random() * 20_000);
  const r = random();
  if (r < 0.5) return 1_000 + Math.floor(random() * 3_000);
  if (r < 0.9) return 4_000 + Math.floor(random() * 14_000);
  return 18_000 + Math.floor(random() * 22_000);
}

function body(index, links) {
  const target = targetBodyBytes(index);
  const parts = [];
  let size = 0;
  let section = 0;
  while (size < target) {
    const block =
      section % 5 === 0
        ? `## ${sentence(3, 6).replace(/\.$/, "")}`
        : section % 5 === 3
          ? Array.from({ length: 4 }, () => `- ${sentence(4, 10)}`).join("\n")
          : Array.from({ length: 4 }, () => sentence()).join(" ");
    parts.push(block);
    size += block.length + 2;
    section += 1;
  }
  for (const link of links) {
    parts.splice(
      Math.min(parts.length, 2),
      0,
      `See [${link.title}](/page/${link.id}).`,
    );
  }
  return parts.join("\n\n");
}

function loadManifest() {
  if (!existsSync(manifestPath))
    return { owner: [], shared: [], databases: [] };
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
  // A new account opens on the first-run questionnaire, which hides the app;
  // the fixture stands in for a returning user.
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

async function runPool(items, worker) {
  let next = 0;
  let completed = 0;
  const started = Date.now();
  async function lane() {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
      completed += 1;
      if (completed % 100 === 0 || completed === items.length) {
        const rate = completed / ((Date.now() - started) / 1000);
        console.log(
          `[perf fixture] ${completed}/${items.length} (${rate.toFixed(1)}/s)`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, lane));
}

// Plan: a 7-level chain, 20 parents with 4 children each and one grandchild
// under each of those parents' first child, and everything else at the root.
function planOwnerPages(ownerCount) {
  const pages = [];
  for (let depth = 0; depth < 7; depth += 1) {
    pages.push({
      key: `chain-${depth}`,
      parentKey: depth === 0 ? null : `chain-${depth - 1}`,
      title: `${prefix} deep chain level ${depth + 1}`,
    });
  }
  for (let parent = 0; parent < 20; parent += 1) {
    pages.push({
      key: `parent-${parent}`,
      parentKey: null,
      title: `${prefix} section ${parent + 1}`,
    });
    for (let child = 0; child < 4; child += 1) {
      pages.push({
        key: `parent-${parent}-child-${child}`,
        parentKey: `parent-${parent}`,
        title: `${prefix} section ${parent + 1} page ${child + 1}`,
      });
    }
    pages.push({
      key: `parent-${parent}-grandchild`,
      parentKey: `parent-${parent}-child-0`,
      title: `${prefix} section ${parent + 1} detail`,
    });
  }
  let root = 0;
  while (pages.length < ownerCount) {
    pages.push({
      key: `root-${root}`,
      parentKey: null,
      title: `${prefix} page ${root + 1}`,
    });
    root += 1;
  }
  return pages;
}

const manifest = loadManifest();
const ownerCookie = await signIn(email, password);
const ownerCount = total - sharedCount;
const ownerPlan = planOwnerPages(ownerCount);
const createdByKey = new Map(manifest.owner.map((page) => [page.key, page]));

// Parents first, level by level, so nested pages always have a real parent.
const levels = [];
for (const page of ownerPlan) {
  let depth = 0;
  let parentKey = page.parentKey;
  while (parentKey) {
    depth += 1;
    parentKey =
      ownerPlan.find((candidate) => candidate.key === parentKey)?.parentKey ??
      null;
  }
  (levels[depth] ??= []).push(page);
}

let pageIndex = 0;
for (const level of levels) {
  const pending = level.filter((page) => !createdByKey.has(page.key));
  await runPool(pending, async (page) => {
    const index = pageIndex++;
    const created = [...createdByKey.values()];
    const links =
      index % 10 === 3 && created.length > 0
        ? [created[Math.floor(random() * created.length)]]
        : [];
    const parent = page.parentKey ? createdByKey.get(page.parentKey) : null;
    const result = await callAction(ownerCookie, "create-document", {
      title: page.title,
      content: body(index, links),
      ...(parent ? { parentId: parent.id } : {}),
    });
    const id = result?.document?.id ?? result?.id;
    if (!id)
      throw new Error(
        `create-document returned no id: ${JSON.stringify(result).slice(0, 200)}`,
      );
    const record = { key: page.key, id, title: page.title };
    createdByKey.set(page.key, record);
    manifest.owner.push(record);
    if (manifest.owner.length % 50 === 0) saveManifest(manifest);
  });
  saveManifest(manifest);
}

for (let n = manifest.databases.length; n < 3; n += 1) {
  const host = createdByKey.get(`parent-${n}`);
  const result = await callAction(
    ownerCookie,
    "create-inline-content-database",
    {
      hostDocumentId: host.id,
      title: `${prefix} tracker ${n + 1}`,
    },
  );
  manifest.databases.push({
    hostId: host.id,
    result: result?.database?.id ?? null,
  });
  saveManifest(manifest);
}

if (sharedCount > 0) {
  const shareCookie = await signIn(shareEmail, sharePassword);
  const pending = Array.from(
    { length: sharedCount - manifest.shared.length },
    (_, i) => manifest.shared.length + i,
  );
  await runPool(pending, async (n) => {
    const title = `${prefix} shared page ${n + 1}`;
    const result = await callAction(shareCookie, "create-document", {
      title,
      content: body(100_000 + n, []),
    });
    const id = result?.document?.id ?? result?.id;
    await callAction(shareCookie, "share-resource", {
      resourceType: "document",
      resourceId: id,
      principalType: "user",
      principalId: email,
      role: "viewer",
      notify: false,
    });
    manifest.shared.push({ id, title });
    if (manifest.shared.length % 50 === 0) saveManifest(manifest);
  });
  saveManifest(manifest);
}

const deepest = createdByKey.get("chain-6");
console.log(
  JSON.stringify(
    {
      manifest: manifestPath,
      ownerPages: manifest.owner.length,
      sharedPages: manifest.shared.length,
      inlineDatabases: manifest.databases.length,
      deepestPageId: deepest?.id ?? null,
      deepestPath: deepest ? `/page/${deepest.id}` : null,
    },
    null,
    2,
  ),
);
