#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type AppName = "calls" | "clips" | "forms" | "slides";

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
  calls: 9311,
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
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, ok: res.ok, data };
}

async function fetchText(
  url: string,
): Promise<{ status: number; ok: boolean; text: string }> {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

async function waitForReady(app: AppName, baseUrl: string, logs: string[]) {
  const deadline = Date.now() + 60_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl);
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

async function smokeCalls({ baseUrl, dbPath }: RunningApp): Promise<void> {
  sqlite(
    dbPath,
    `
INSERT INTO workspaces (id, name, slug, owner_email, visibility)
VALUES ('qa-workspace-calls', 'QA Workspace', 'qa-workspace-calls', 'qa+calls@example.test', 'private');

INSERT INTO calls (
  id, workspace_id, title, description, duration_ms, media_url, media_kind,
  media_format, width, height, status, password, share_includes_summary,
  share_includes_transcript, owner_email, visibility
) VALUES (
  'qa-call-public', 'qa-workspace-calls', 'QA Passworded Call',
  'Public share call seeded by qa-public-share-smoke.', 61000,
  '/api/call-media/qa-call-public', 'video', 'mp4', 1280, 720, 'ready',
  'call-secret', 1, 1, 'qa+calls@example.test', 'public'
);

INSERT INTO call_summaries (
  call_id, recap, key_points_json, next_steps_json, topics_json,
  questions_json, action_items_json, sentiment, generated_at
) VALUES (
  'qa-call-public', 'Recap for a locally seeded public call.',
  '["Budget confirmed"]', '["Send follow-up"]', '["Pricing"]', '[]', '[]',
  'positive', datetime('now')
);

INSERT INTO call_transcripts (
  call_id, owner_email, language, provider, segments_json, full_text, status
) VALUES (
  'qa-call-public', 'qa+calls@example.test', 'en', 'deepgram',
  '[{"id":"seg-1","speaker":"Speaker 1","startMs":0,"endMs":2500,"text":"Hello from local QA."}]',
  'Hello from local QA.', 'ready'
);

INSERT INTO call_participants (
  id, call_id, speaker_label, display_name, email, color, talk_ms, talk_pct
) VALUES (
  'qa-call-participant', 'qa-call-public', 'Speaker 1', 'QA Speaker',
  'qa+speaker@example.test', '#111111', 2500, 100
);

INSERT INTO snippets (
  id, call_id, workspace_id, title, description, start_ms, end_ms, password,
  owner_email, visibility
) VALUES (
  'qa-snippet-public', 'qa-call-public', 'qa-workspace-calls',
  'QA Passworded Snippet', 'Public snippet seeded by qa-public-share-smoke.',
  1000, 4000, 'snippet-secret', 'qa+calls@example.test', 'public'
);
`,
  );

  const lockedCall = await fetchJson(`${baseUrl}/api/public-call?callId=qa-call-public`);
  assert.equal(lockedCall.status, 401);
  assert.equal((lockedCall.data as any).passwordRequired, true);

  const call = await fetchJson(
    `${baseUrl}/api/public-call?callId=qa-call-public&p=call-secret`,
  );
  assert.equal(call.status, 200);
  assert.equal((call.data as any).call.title, "QA Passworded Call");
  assert.equal((call.data as any).call.hasPassword, true);
  assert.match((call.data as any).call.mediaUrl, /p=call-secret/);
  assert.equal((call.data as any).summary.recap, "Recap for a locally seeded public call.");
  assert.equal((call.data as any).transcript.status, "ready");
  assert.equal((call.data as any).participants.length, 1);
  assert.equal("password" in (call.data as any).call, false);

  const callPage = await fetchText(`${baseUrl}/share/qa-call-public`);
  assert.equal(callPage.status, 200);

  const lockedSnippet = await fetchJson(
    `${baseUrl}/api/public-snippet?snippetId=qa-snippet-public`,
  );
  assert.equal(lockedSnippet.status, 401);
  assert.equal((lockedSnippet.data as any).passwordRequired, true);

  const snippet = await fetchJson(
    `${baseUrl}/api/public-snippet?snippetId=qa-snippet-public&p=snippet-secret`,
  );
  assert.equal(snippet.status, 200);
  assert.equal((snippet.data as any).snippet.title, "QA Passworded Snippet");
  assert.match((snippet.data as any).call.mediaUrl, /#t=1\.000,4\.000$/);

  const snippetPage = await fetchText(`${baseUrl}/share-snippet/qa-snippet-public`);
  assert.equal(snippetPage.status, 200);
}

async function smokeClips({ baseUrl, dbPath }: RunningApp): Promise<void> {
  sqlite(
    dbPath,
    `
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
`,
  );

  const locked = await fetchJson(`${baseUrl}/api/public-recording?id=qa-recording-public`);
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

  const publicForm = await fetchJson(`${baseUrl}/api/forms/public/qa%2Fpublic-form`);
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
  ["calls", smokeCalls],
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
