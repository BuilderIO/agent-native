#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  spawn,
  execFileSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type AppName = "clips" | "forms" | "slides";

interface RunningApp {
  app: AppName;
  baseUrl: string;
  dbPath: string;
  child: ChildProcessWithoutNullStreams;
  logs: string[];
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "an-public-share-qa-"));
const ports: Record<AppName, number> = {
  clips: 9312,
  forms: 9313,
  slides: 9314,
};

function appEnv(app: AppName, dbPath: string): NodeJS.ProcessEnv {
  const databaseUrl = `file:${dbPath}`;
  return {
    ...process.env,
    APP_NAME: app,
    NODE_ENV: "development",
    DATABASE_URL: databaseUrl,
    DATABASE_AUTH_TOKEN: "",
    [`${app.toUpperCase()}_DATABASE_URL`]: databaseUrl,
    [`${app.toUpperCase()}_DATABASE_AUTH_TOKEN`]: "",
    NO_COLOR: "1",
  };
}

function sqlite(dbPath: string, sql: string): void {
  execFileSync("sqlite3", [dbPath], {
    input: sql,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function fetchJson<T = any>(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; ok: boolean; data: T }> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, ok: res.ok, data };
}

async function fetchText(
  url: string,
): Promise<{ status: number; ok: boolean; text: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

async function fetchBytes(
  url: string,
  init?: RequestInit,
): Promise<{
  status: number;
  ok: boolean;
  bytes: Uint8Array;
  headers: Headers;
}> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, ok: res.ok, bytes, headers: res.headers };
}

async function waitForReady(app: AppName, baseUrl: string, logs: string[]) {
  const deadline = Date.now() + 60_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(2_000),
      });
      if (res.status < 500) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `${app} did not become ready at ${baseUrl}: ${lastError}\n${logs
      .slice(-80)
      .join("")}`,
  );
}

async function startApp(app: AppName): Promise<RunningApp> {
  const port = ports[app];
  const dbPath = path.join(tmpRoot, `${app}.db`);
  const templateDir = path.join(repoRoot, "templates", app);
  const logs: string[] = [];
  const child = spawn(
    "pnpm",
    [
      "--dir",
      templateDir,
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: repoRoot,
      env: appEnv(app, dbPath),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  child.on("exit", (code, signal) => {
    logs.push(`\n[${app}] exited code=${code} signal=${signal}\n`);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForReady(app, baseUrl, logs);
  return { app, baseUrl, dbPath, child, logs };
}

async function stopApp(running: RunningApp): Promise<void> {
  if (running.child.exitCode != null) return;
  running.child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => running.child.once("exit", () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (running.child.exitCode == null) running.child.kill("SIGKILL");
        resolve();
      }, 5_000),
    ),
  ]);
}

async function withApp(
  app: AppName,
  fn: (running: RunningApp) => Promise<void>,
): Promise<void> {
  const running = await startApp(app);
  try {
    await fn(running);
  } finally {
    await stopApp(running);
  }
}

async function smokeClips({ baseUrl, dbPath }: RunningApp): Promise<void> {
  const recordingBlob = Buffer.from("clip-video-bytes").toString("base64");
  sqlite(
    dbPath,
    `
CREATE TABLE IF NOT EXISTS application_state (
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, key)
);

INSERT INTO workspaces (id, name, slug, owner_email, visibility)
VALUES ('qa-workspace-clips', 'QA Workspace', 'qa-workspace-clips', 'qa+clips@example.test', 'private');

INSERT INTO recordings (
  id, workspace_id, title, description, duration_ms, video_url, video_format,
  width, height, status, upload_progress, password, enable_comments,
  enable_reactions, enable_downloads, owner_email, visibility
) VALUES (
  'qa-recording-public', 'qa-workspace-clips', 'QA Passworded Clip',
  'Public clip seeded by qa-public-share-smoke.', 42000,
  '/api/video/qa-recording-public', 'mp4', 1280, 720, 'ready', 100,
  'clip-secret', 1, 0, 1, 'qa+clips@example.test', 'public'
);

INSERT INTO recording_transcripts (
  recording_id, owner_email, language, segments_json, full_text, status
) VALUES (
  'qa-recording-public', 'qa+clips@example.test', 'en',
  '[{"startMs":0,"endMs":2000,"text":"Welcome to the local QA clip."}]',
  'Welcome to the local QA clip.', 'ready'
);

INSERT INTO recording_comments (
  id, recording_id, workspace_id, thread_id, author_email, author_name,
  content, video_timestamp_ms
) VALUES (
  'qa-recording-comment', 'qa-recording-public', 'qa-workspace-clips',
  'qa-thread', 'qa+viewer@example.test', 'QA Viewer',
  'Looks good from local QA.', 1500
);

INSERT INTO recording_ctas (id, recording_id, label, url, color, placement)
VALUES (
  'qa-recording-cta', 'qa-recording-public', 'Book demo',
  'https://example.test/demo', '#111111', 'throughout'
);

INSERT INTO application_state (session_id, key, value, updated_at)
VALUES (
  'local',
  'recording-blob-qa-recording-public',
  '${JSON.stringify({ data: recordingBlob, mimeType: "video/mp4" }).replaceAll("'", "''")}',
  strftime('%s','now') * 1000
);
`,
  );

  const locked = await fetchJson(
    `${baseUrl}/api/public-recording?id=qa-recording-public`,
  );
  assert.equal(locked.status, 401);
  assert.equal((locked.data as any).passwordRequired, true);

  const wrong = await fetchJson(
    `${baseUrl}/api/public-recording?id=qa-recording-public&password=wrong`,
  );
  assert.equal(wrong.status, 401);
  assert.equal((wrong.data as any).passwordRequired, true);

  const open = await fetchJson(
    `${baseUrl}/api/public-recording?id=qa-recording-public&password=clip-secret`,
  );
  assert.equal(open.status, 200);
  assert.equal((open.data as any).recording.title, "QA Passworded Clip");
  assert.equal((open.data as any).recording.hasPassword, true);
  assert.match((open.data as any).recording.videoUrl, /password=clip-secret/);
  assert.equal((open.data as any).transcript.status, "ready");
  assert.equal((open.data as any).comments.length, 1);
  assert.equal((open.data as any).ctas[0].label, "Book demo");
  assert.equal("password" in (open.data as any).recording, false);

  const sharePage = await fetchText(`${baseUrl}/share/qa-recording-public`);
  assert.equal(sharePage.status, 200);

  const embedPage = await fetchText(`${baseUrl}/embed/qa-recording-public`);
  assert.equal(embedPage.status, 200);

  const lockedMedia = await fetchJson(
    `${baseUrl}/api/video/qa-recording-public`,
  );
  assert.equal(lockedMedia.status, 401);

  const media = await fetchBytes(
    `${baseUrl}/api/video/qa-recording-public?password=clip-secret`,
    { headers: { Range: "bytes=-5" } },
  );
  assert.equal(media.status, 206);
  assert.equal(media.headers.get("content-type"), "video/mp4");
  assert.equal(media.headers.get("content-range"), "bytes 11-15/16");
  assert.equal(Buffer.from(media.bytes).toString("utf8"), "bytes");
}

async function smokeForms({ baseUrl, dbPath }: RunningApp): Promise<void> {
  sqlite(
    dbPath,
    `
INSERT INTO forms (
  id, title, description, slug, fields, settings, status, created_at,
  updated_at, owner_email, visibility
) VALUES (
  'qa-form-public', 'QA Published Form',
  'A local public form for QA.', 'qa/public-form',
  '[{"id":"name","type":"text","label":"Name","required":true},{"id":"email","type":"email","label":"Email","required":true},{"id":"notes","type":"textarea","label":"Notes","required":false}]',
  '{"submitText":"Send QA","successMessage":"QA response received","allowedOrigins":[]}',
  'published', datetime('now'), datetime('now'),
  'qa+forms@example.test', 'public'
);
`,
  );

  const publicForm = await fetchJson(
    `${baseUrl}/api/forms/public/qa%2Fpublic-form`,
  );
  assert.equal(publicForm.status, 200);
  assert.equal((publicForm.data as any).title, "QA Published Form");
  assert.equal((publicForm.data as any).fields.length, 3);

  const page = await fetchText(`${baseUrl}/f/qa/public-form`);
  assert.equal(page.status, 200);
  assert.match(page.text, /QA Published Form/);
  assert.match(page.text, /Send QA/);

  const submitted = await fetchJson(`${baseUrl}/api/submit/qa-form-public`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: {
        name: "Local QA",
        email: "qa+submitter@example.test",
        notes: "Positive public submission smoke.",
        unexpected: "must be stripped",
      },
      _hp: "",
      _t: Date.now() - 1_000,
    }),
  });
  assert.equal(submitted.status, 200);
  assert.equal((submitted.data as any).success, true);
  assert.match((submitted.data as any).id, /\S/);

  const rows = execFileSync(
    "sqlite3",
    [dbPath, "SELECT data FROM responses WHERE form_id = 'qa-form-public'"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  assert.equal(rows.length, 1);
  const responseData = JSON.parse(rows[0]);
  assert.equal(responseData.name, "Local QA");
  assert.equal(responseData.email, "qa+submitter@example.test");
  assert.equal(responseData.unexpected, undefined);
}

async function smokeSlides({ baseUrl, dbPath }: RunningApp): Promise<void> {
  sqlite(
    dbPath,
    `
INSERT INTO deck_share_links (token, title, slides, aspect_ratio, created_at)
VALUES (
  'qa-slide-share-token', 'QA Shared Deck',
  '[{"id":"slide-1","content":"<section><h1>Local QA Shared Slide</h1><p>Public share route smoke.</p></section>","notes":"","layout":"content","background":"#ffffff"}]',
  '16:9', datetime('now')
);
`,
  );

  const shared = await fetchJson(`${baseUrl}/api/share/qa-slide-share-token`);
  assert.equal(shared.status, 200);
  assert.equal((shared.data as any).title, "QA Shared Deck");
  assert.equal((shared.data as any).slides.length, 1);
  assert.equal((shared.data as any).slides[0].notes, "");
  assert.equal((shared.data as any).aspectRatio, "16:9");

  const page = await fetchText(`${baseUrl}/share/qa-slide-share-token`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Shared Presentation|Local QA Shared Slide|root/);
}

const checks: Array<[AppName, (running: RunningApp) => Promise<void>]> = [
  ["clips", smokeClips],
  ["forms", smokeForms],
  ["slides", smokeSlides],
];

try {
  for (const [app, smoke] of checks) {
    process.stdout.write(`qa-public-share-smoke: ${app}... `);
    await withApp(app, smoke);
    process.stdout.write("clean\n");
  }
  console.log("qa-public-share-smoke: all clean");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
