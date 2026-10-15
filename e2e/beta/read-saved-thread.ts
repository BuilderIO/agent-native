import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

import {
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { originFor, siteById } from "./lib/fleet";
import {
  inspectPersistedAssistantProvenance,
  type PersistedAssistantProvenance,
} from "./lib/persisted-assistant-provenance";
import {
  selectRecoveryThreadRef,
  type RecoveryArtifactSelection,
} from "./lib/recovery-artifact-selection";
import { recoveryCookieHeader } from "./lib/recovery-cookies";
import { discardRecoveryResponseBody } from "./lib/recovery-response-body";
import { selectRecoverySessionToken } from "./lib/recovery-session-token";
import { expectedEmail, sessionTokenFor } from "./lib/session";
import { BETA_E2E_TEST_TRAFFIC_HEADERS } from "./lib/test-traffic";

const REPOSITORY = "BuilderIO/agent-native";
const WORKFLOW_PATH = ".github/workflows/beta-e2e.yml";
const WORKFLOW_NAME = "Beta E2E (browser)";
const EXACT_GREP = String.raw`\[chat-reliability\] refresh mid-run restores the complete answer`;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_GITHUB_JSON_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 24 * 1024 * 1024;
const MAX_RESULTS_BYTES = 4 * 1024 * 1024;
const MAX_THREAD_BYTES = 4 * 1024 * 1024;
const MAX_IDENTITY_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

type AppId = "content" | "dispatch";
type Phase = "request" | "artifact" | "session" | "thread" | "summary";

class DiagnosticFailure extends Error {
  constructor(
    readonly phase: Phase,
    readonly code: string,
    readonly exitCode = 2,
  ) {
    super(code);
  }
}

interface DiagnosticRequest {
  app: AppId;
  runId: string;
  singleApp: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(phase: Phase, code: string, exitCode = 2): never {
  throw new DiagnosticFailure(phase, code, exitCode);
}

function readRequest(): DiagnosticRequest {
  const app = process.env.BETA_E2E_APPS;
  if (app !== "content" && app !== "dispatch") {
    fail("request", "invalid_app");
  }
  if (
    process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    process.env.GITHUB_REPOSITORY !== REPOSITORY
  ) {
    fail("request", "invalid_context");
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) fail("request", "event_missing");
  try {
    if (statSync(eventPath).size > MAX_EVENT_BYTES) {
      fail("request", "event_too_large");
    }
    const event: unknown = JSON.parse(readFileSync(eventPath, "utf8"));
    const inputs =
      isRecord(event) && isRecord(event.inputs) ? event.inputs : null;
    const runId = inputs?.diagnostic_run;
    const apps = inputs?.apps;
    if (
      !isRecord(event) ||
      !isRecord(event.repository) ||
      event.repository.full_name !== REPOSITORY ||
      typeof runId !== "string" ||
      !/^[1-9]\d{0,14}$/.test(runId) ||
      !Number.isSafeInteger(Number(runId)) ||
      inputs?.lane !== "authed" ||
      !["content", "dispatch", "content,dispatch"].includes(String(apps)) ||
      (apps !== "content,dispatch" && apps !== app) ||
      inputs?.grep !== EXACT_GREP
    ) {
      fail("request", "invalid_shape");
    }
    return { app, runId, singleApp: apps === app };
  } catch (error) {
    if (error instanceof DiagnosticFailure) throw error;
    fail("request", "event_unreadable");
  }
}

function tokenForApp(app: AppId, singleApp: boolean): string {
  const raw = process.env.BETA_E2E_SESSION_TOKENS;
  if (!raw) fail("session", "app_token_missing");
  if (raw.length > MAX_EVENT_BYTES) fail("session", "token_map_unreadable");
  let tokens: unknown;
  try {
    tokens = JSON.parse(raw);
  } catch {
    fail("session", "token_map_unreadable");
  }
  if (!isRecord(tokens)) fail("session", "token_map_unreadable");
  let resolved: string | undefined;
  try {
    resolved = sessionTokenFor(app);
  } catch {
    fail("session", "token_map_unreadable");
  }
  const selection = selectRecoverySessionToken(
    app,
    tokens,
    resolved,
    singleApp,
  );
  if (selection.kind !== "selected") fail("session", selection.code);
  return selection.token;
}

function apiBase(): URL {
  return new URL("https://api.github.com/");
}

function githubHeaders(token: string): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

async function cancelBody(response: Response, phase: Phase): Promise<void> {
  const result = await discardRecoveryResponseBody(response.body);
  if (result.kind === "unreadable") fail(phase, "response_discard_failed");
}

async function boundedResponseBytes(
  response: Response,
  maximumBytes: number,
  phase: Phase,
  tooLargeCode: string,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      await cancelBody(response, phase);
      fail(phase, "invalid_content_length");
    }
    if (Number(contentLength) > maximumBytes) {
      await cancelBody(response, phase);
      fail(phase, tooLargeCode);
    }
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        fail(phase, tooLargeCode);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function githubJson(url: URL, token: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: githubHeaders(token),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    fail("artifact", "github_unavailable");
  }
  if (response.status === 404) {
    await cancelBody(response, "artifact");
    fail("artifact", "run_or_artifact_missing", 1);
  }
  if (response.status !== 200) {
    await cancelBody(response, "artifact");
    fail("artifact", "github_response");
  }
  const bytes = await boundedResponseBytes(
    response,
    MAX_GITHUB_JSON_BYTES,
    "artifact",
    "github_response_too_large",
  );
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("artifact", "github_response_unreadable");
  }
}

async function findRunArtifact(
  runId: string,
  app: AppId,
  token: string,
): Promise<number> {
  const base = apiBase();
  const runUrl = new URL(`repos/${REPOSITORY}/actions/runs/${runId}`, base);
  const run = await githubJson(runUrl, token);
  if (
    !isRecord(run) ||
    String(run.id) !== runId ||
    run.name !== WORKFLOW_NAME ||
    run.path !== WORKFLOW_PATH ||
    run.status !== "completed"
  ) {
    fail("artifact", "run_mismatch");
  }
  if (run.run_attempt !== 1) fail("artifact", "run_attempt_ambiguous");

  const expectedName = `beta-e2e-authed-chat-${app}-${runId}`;
  const artifacts: Array<Record<string, unknown>> = [];
  let expectedTotal: number | undefined;
  for (let page = 1; page <= 5; page += 1) {
    const url = new URL(
      `repos/${REPOSITORY}/actions/runs/${runId}/artifacts`,
      base,
    );
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const listing = await githubJson(url, token);
    if (
      !isRecord(listing) ||
      !Array.isArray(listing.artifacts) ||
      typeof listing.total_count !== "number" ||
      !Number.isInteger(listing.total_count) ||
      listing.total_count < 0 ||
      listing.artifacts.some((artifact) => !isRecord(artifact))
    ) {
      fail("artifact", "artifact_list_unreadable");
    }
    if (expectedTotal === undefined) expectedTotal = listing.total_count;
    if (
      listing.total_count !== expectedTotal ||
      listing.artifacts.length > 100
    ) {
      fail("artifact", "artifact_list_ambiguous");
    }
    artifacts.push(...(listing.artifacts as Array<Record<string, unknown>>));
    if (artifacts.length >= expectedTotal) break;
  }
  if (expectedTotal === undefined || artifacts.length !== expectedTotal) {
    fail("artifact", "artifact_list_incomplete");
  }

  const matches = artifacts.filter(
    (artifact) => artifact.name === expectedName,
  );
  if (matches.length === 0) fail("artifact", "artifact_missing", 1);
  if (matches.length !== 1) fail("artifact", "artifact_ambiguous");
  const artifact = matches[0];
  const expiresAt =
    typeof artifact.expires_at === "string"
      ? Date.parse(artifact.expires_at)
      : Number.NaN;
  if (
    artifact.expired !== false ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    fail("artifact", "artifact_expired", 1);
  }
  if (
    typeof artifact.id !== "number" ||
    !Number.isSafeInteger(artifact.id) ||
    artifact.id <= 0
  ) {
    fail("artifact", "artifact_list_unreadable");
  }
  return artifact.id;
}

async function downloadArtifactZip(
  artifactId: number,
  token: string,
): Promise<Uint8Array> {
  const url = new URL(
    `repos/${REPOSITORY}/actions/artifacts/${artifactId}/zip`,
    apiBase(),
  );
  let response: Response;
  try {
    response = await fetch(url, {
      headers: githubHeaders(token),
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    fail("artifact", "artifact_download_unavailable");
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    await cancelBody(response, "artifact");
    if (!location || location.length > 8192) {
      fail("artifact", "artifact_download_unreadable");
    }
    let signedUrl: URL;
    try {
      signedUrl = new URL(location, url);
    } catch {
      fail("artifact", "artifact_download_unreadable");
    }
    if (
      signedUrl.protocol !== "https:" ||
      signedUrl.username ||
      signedUrl.password
    ) {
      fail("artifact", "artifact_download_unreadable");
    }
    try {
      response = await fetch(signedUrl, {
        headers: { accept: "application/zip" },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      fail("artifact", "artifact_download_unavailable");
    }
  }
  if (response.status !== 200) {
    await cancelBody(response, "artifact");
    fail("artifact", "artifact_download_response");
  }
  return boundedResponseBytes(
    response,
    MAX_ARTIFACT_BYTES,
    "artifact",
    "artifact_too_large",
  );
}

function extractResultsJson(zip: Uint8Array, app: AppId): unknown {
  const slot = `authed-chat-${app}`;
  const member = `playwright-report/${slot}/results.json`;
  const python = String.raw`
import io
import sys
import zipfile

MAX_ZIP = 24 * 1024 * 1024
MAX_RESULT = 4 * 1024 * 1024
MAX_ENTRIES = 256
try:
    archive_bytes = sys.stdin.buffer.read(MAX_ZIP + 1)
    if len(archive_bytes) > MAX_ZIP:
        raise SystemExit(21)
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_ENTRIES:
            raise SystemExit(22)
        target = sys.argv[1]
        matches = [entry for entry in entries if entry.filename == target]
        if len(matches) != 1 or matches[0].is_dir():
            raise SystemExit(23 if not matches else 24)
        entry = matches[0]
        if entry.file_size > MAX_RESULT:
            raise SystemExit(25)
        with archive.open(entry) as source:
            result = source.read(MAX_RESULT + 1)
        if len(result) > MAX_RESULT or len(result) != entry.file_size:
            raise SystemExit(26)
        sys.stdout.buffer.write(result)
except SystemExit:
    raise
except Exception:
    raise SystemExit(27)
`;
  const result = spawnSync("python3", ["-c", python, member], {
    input: Buffer.from(zip),
    maxBuffer: MAX_RESULTS_BYTES + 1,
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error || result.status === null) {
    fail("artifact", "archive_reader_unavailable");
  }
  if (result.status !== 0) {
    const codes: Record<number, string> = {
      21: "artifact_too_large",
      22: "artifact_unreadable",
      23: "results_missing",
      24: "results_ambiguous",
      25: "results_too_large",
      26: "artifact_unreadable",
      27: "artifact_unreadable",
    };
    const code = codes[result.status] ?? "artifact_unreadable";
    fail("artifact", code, code === "results_missing" ? 1 : 2);
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(result.stdout),
    );
  } catch {
    fail("artifact", "results_unreadable");
  }
}

async function boundedJsonFetch(
  url: URL,
  origin: URL,
  context: APIRequestContext,
  pathname: string,
  maximumBytes: number,
  phase: Phase,
): Promise<{ status: number; body?: unknown }> {
  if (
    origin.protocol !== "https:" ||
    url.protocol !== "https:" ||
    url.origin !== origin.origin ||
    url.pathname !== pathname ||
    url.search ||
    url.hash
  ) {
    fail(phase, "origin_untrusted");
  }
  const cookieResult = recoveryCookieHeader(
    (await context.storageState()).cookies,
    origin,
    url,
  );
  if (cookieResult.kind === "missing") {
    fail(phase, "session_cookie_missing");
  }
  if (cookieResult.kind === "unreadable") {
    fail(phase, `session_cookie_${cookieResult.reason}`);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
        cookie: cookieResult.value,
        ...BETA_E2E_TEST_TRAFFIC_HEADERS,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    fail(phase, "read_unavailable");
  }
  if (response.status !== 200) {
    await cancelBody(response, phase);
    return { status: response.status };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    await cancelBody(response, phase);
    fail(phase, "read_unreadable");
  }
  const bytes = await boundedResponseBytes(
    response,
    maximumBytes,
    phase,
    "read_too_large",
  );
  try {
    return {
      status: 200,
      body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    };
  } catch {
    fail(phase, "read_unreadable");
  }
}

async function readExistingThread(
  app: AppId,
  threadRef: string,
  singleApp: boolean,
): Promise<unknown> {
  const site = siteById(app);
  const origin = new URL(originFor(site));
  const token = tokenForApp(app, singleApp);
  let context: APIRequestContext | undefined;
  let exchangeResponse: APIResponse | undefined;
  let value: unknown;
  let failure: unknown;
  let hadFailure = false;
  let cleanupFailed = false;
  try {
    expectedEmail();
    context = await playwrightRequest.newContext({
      baseURL: origin.toString(),
      extraHTTPHeaders: {
        accept: "application/json",
        ...BETA_E2E_TEST_TRAFFIC_HEADERS,
      },
      timeout: REQUEST_TIMEOUT_MS,
      ignoreHTTPSErrors: false,
    });
    exchangeResponse = await context.get("/_agent-native/auth/session", {
      params: { _session: token },
      maxRedirects: 0,
      timeout: REQUEST_TIMEOUT_MS,
      failOnStatusCode: false,
    });
    if (exchangeResponse.status() < 200 || exchangeResponse.status() >= 300) {
      fail("session", "session_exchange_failed");
    }

    const expected = expectedEmail().toLowerCase();
    const identityUrl = new URL("/_agent-native/auth/session", origin);
    const identity = await boundedJsonFetch(
      identityUrl,
      origin,
      context,
      identityUrl.pathname,
      MAX_IDENTITY_BYTES,
      "session",
    );
    if (identity.status === 401) fail("session", "identity_unauthenticated");
    if (identity.status !== 200 || !isRecord(identity.body)) {
      fail("session", "identity_unreadable");
    }
    const email = identity.body.email;
    if (typeof email !== "string" || email.toLowerCase() !== expected) {
      fail("session", "identity_mismatch");
    }

    const threadPath = `/_agent-native/agent-chat/threads/${encodeURIComponent(threadRef)}`;
    const threadUrl = new URL(threadPath, origin);
    const thread = await boundedJsonFetch(
      threadUrl,
      origin,
      context,
      threadUrl.pathname,
      MAX_THREAD_BYTES,
      "thread",
    );
    if (thread.status === 404) fail("thread", "thread_not_found", 1);
    if (thread.status === 401 || thread.status === 403) {
      fail("thread", "thread_access_denied");
    }
    if (thread.status !== 200) fail("thread", "thread_unavailable");
    value = thread.body;
  } catch (error) {
    hadFailure = true;
    failure = error;
  } finally {
    if (exchangeResponse) {
      try {
        await exchangeResponse.dispose();
      } catch {
        cleanupFailed = true;
      }
    }
    if (context) {
      try {
        await context.dispose();
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (cleanupFailed) fail("session", "context_dispose_failed");
  if (hadFailure) {
    if (failure instanceof DiagnosticFailure) throw failure;
    fail("session", "session_or_thread_unavailable");
  }
  return value;
}

function selectionFailure(selection: RecoveryArtifactSelection): never {
  if (selection.kind === "missing") {
    fail("artifact", `test_${selection.reason}_missing`, 1);
  }
  if (selection.kind === "ambiguous") {
    fail("artifact", `test_${selection.reason}_ambiguous`);
  }
  if (selection.kind === "unreadable") {
    fail("artifact", `test_${selection.reason}_unreadable`);
  }
  fail("artifact", "test_selection_unreadable");
}

interface DiagnosticSummary {
  app: AppId;
  phase: "summary";
  provenance: PersistedAssistantProvenance;
}

function summarizeProvenance(app: AppId, body: unknown): DiagnosticSummary {
  return {
    app,
    phase: "summary",
    provenance: inspectPersistedAssistantProvenance(body),
  };
}

function emit(record: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

async function main(): Promise<void> {
  const { app, runId, singleApp } = readRequest();
  const token = process.env.GH_TOKEN;
  if (!token) fail("artifact", "github_token_missing");
  const artifactId = await findRunArtifact(runId, app, token);
  const zip = await downloadArtifactZip(artifactId, token);
  const report = extractResultsJson(zip, app);
  const selection = selectRecoveryThreadRef(report, app);
  if (selection.kind !== "selected") selectionFailure(selection);
  const summary = summarizeProvenance(
    app,
    await readExistingThread(app, selection.threadRef, singleApp),
  );
  emit({
    app: summary.app,
    phase: summary.phase,
    provenance: summary.provenance,
  });
  if (summary.provenance.kind !== "ok" || !summary.provenance.scanComplete)
    process.exitCode = 2;
}

void main().catch((error: unknown) => {
  const app = process.env.BETA_E2E_APPS;
  const safeApp = app === "content" || app === "dispatch" ? app : "unknown";
  if (error instanceof DiagnosticFailure) {
    emit({
      status: error.exitCode === 1 ? "missing" : "unavailable",
      app: safeApp,
      phase: error.phase,
      code: error.code,
    });
    process.exitCode = error.exitCode;
    return;
  }
  emit({
    status: "unavailable",
    app: safeApp,
    phase: "request",
    code: "unexpected",
  });
  process.exitCode = 2;
});
