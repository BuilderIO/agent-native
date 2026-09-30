// Saves a Clips recording's context, transcript and frames under
// templates/design/.tmp/parity/clip-<id>/ and lays the frames out as one
// contact sheet, captioned with what was said at each moment.
//
//   node .agents/skills/design-clip-repro/scripts/clip.mjs <clip link> [atMs,atMs,...]
//
// Without timestamps it saves the clip's recommended frames.
import { mkdirSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

import { WORKTREE } from "../harness/harness-env.mjs";
import { sheet } from "../harness/sheet.mjs";

const [link, times] = process.argv.slice(2);
if (!link) {
  console.error("usage: clip.mjs <clip link> [atMs,atMs,...]");
  process.exit(2);
}
const url = new URL(link);
const id = url.pathname.split("/").filter(Boolean).pop();
const contextUrl = new URL("/api/agent-context.json", url.origin);
contextUrl.searchParams.set("id", id);
const token = url.searchParams.get("agent_access");
// The context's frame URLs already carry their own scoped token.
if (token) contextUrl.searchParams.set("agent_access", token);

/** Fetch that waits out 429s (Retry-After, capped) instead of hammering the clips API. */
async function get(u) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(u);
    if (res.status !== 429 || attempt > 3) return res;
    await new Promise((r) =>
      setTimeout(
        r,
        Math.min(Number(res.headers.get("retry-after")) || 10, 30) * 1000,
      ),
    );
  }
}

const ctxRes = await get(contextUrl);
if (!ctxRes.ok)
  throw new Error(
    `clip context ${ctxRes.status}: private clips need their agent_access link`,
  );
const context = await ctxRes.json();

const dir = `${WORKTREE}/templates/design/.tmp/parity/clip-${id}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/context.json`, JSON.stringify(context, null, 2));
const segments = context.transcript?.segments ?? [];
writeFileSync(
  `${dir}/transcript.txt`,
  segments.map((s) => `[${s.timestamp}] ${s.text}`).join("\n"),
);

const frameTemplate = context.apis.frame.urlTemplate;
const frameOrigin = new URL(frameTemplate, url).origin;
if (frameOrigin !== url.origin) {
  throw new Error(
    `clip frames are served from ${frameOrigin}, not ${url.origin}; refusing to fetch them`,
  );
}

const wanted = times
  ? times.split(",").map((t) => ({ atMs: Number(t) }))
  : (context.recommendedFrames ?? []);
const frames = [];
const failed = [];
for (const f of wanted) {
  const res = await get(frameTemplate.replace("{timestampMs}", String(f.atMs)));
  if (!res.ok) {
    failed.push(`${f.atMs}ms: HTTP ${res.status}`);
    continue;
  }
  const path = `${dir}/f-${String(f.atMs).padStart(7, "0")}.jpg`;
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  const said = segments
    .filter((s) => s.endMs >= f.atMs - 3000 && s.startMs <= f.atMs + 3000)
    .map((s) => s.text)
    .join(" ");
  frames.push({
    path,
    label: `${Math.floor(f.atMs / 60000)}:${String(Math.floor(f.atMs / 1000) % 60).padStart(2, "0")}`,
    said,
  });
}
const contact = await sheet(
  `clip ${id}: ${context.clip?.title ?? ""}`,
  frames.map((f) => ({ label: f.label, image: f.path, caption: f.said })),
  { columns: 3, cellWidth: 560, out: `${dir}/contact-sheet.jpg` },
);

const clip = context.clip ?? {};
const designIds = [
  ...new Set(
    (
      JSON.stringify(context).match(
        /design\.agent-native\.com\/design\/[A-Za-z0-9_-]+/g,
      ) ?? []
    ).map((u) => u.split("/").pop()),
  ),
];
console.log(`clip: ${clip.title} (${clip.duration})`);
if (clip.description) console.log(`description: ${clip.description}`);
if (context.bugReport)
  console.log(`bugReport: ${JSON.stringify(context.bugReport).slice(0, 800)}`);
console.log(
  designIds.length > 0
    ? `design ids: ${designIds.join(", ")}`
    : "design id: not in the clip; read the URL bar in the frames, or ask the user",
);
const rel = (p) => relative(WORKTREE, p);
console.log(`transcript: ${rel(`${dir}/transcript.txt`)}`);
console.log(`contact sheet (open this first): ${rel(contact)}`);
console.log(
  `frames (open one only for detail): ${frames.map((f) => `${f.label} ${rel(f.path)}`).join(" | ")}`,
);
if (failed.length > 0)
  console.log(`frames that failed to download: ${failed.join(", ")}`);
