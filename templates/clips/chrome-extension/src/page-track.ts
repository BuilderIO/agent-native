export const PAGE_TRACK_PORT_NAME = "clips-page-track";
export const PAGE_TRACK_RRWEB = "@rrweb/record@2.1.0";
export const PAGE_TRACK_CHECKOUT_MS = 60_000;
export const PAGE_TRACK_SYNC_INTERVAL_MS = 10_000;
export const PAGE_TRACK_CHUNK_BYTES = 4 * 256 * 1024;

const MEMBER_INTERVAL_MS = 5_000;
const MEMBER_MAX_TEXT_CHARS = 1024 * 1024;
const MAX_BATCH_CHARS = 32 * 1024 * 1024;
const STOP_FLUSH_TIMEOUT_MS = 1_500;
const CHUNK_ATTEMPTS = 5;
const CHUNK_RETRY_BASE_MS = 500;
const CHUNK_RETRY_MAX_MS = 8_000;
const CHUNK_TIMEOUT_MS = 60_000;
const FINALIZE_ATTEMPTS = 6;
const FINALIZE_RETRY_BASE_MS = 1_000;
const FINALIZE_RETRY_MAX_MS = 30_000;
const MAX_SYNC_POINTS = 10_000;

export type PageTrackCapture = "tab" | "window" | "display";

export type PageTrackRecorderConfig = {
  checkoutMs: number;
  capture: PageTrackCapture;
  captureWidthPx: number;
  captureHeightPx: number;
};

export type PageTrackCommand =
  | { kind: "start"; config: PageTrackRecorderConfig; paused: boolean }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "stop" };

export type PageTrackPortMessage =
  | { kind: "events"; lines: string }
  | { kind: "stopped" };

export type PageTrackPort = {
  postMessage(message: PageTrackCommand): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
};

export type PageTrackWriter = {
  surface: "extension";
  app: string;
  version: string;
  os: string;
};

export type PageTrackOptions = {
  tracksUrl: string;
  authToken: string | null;
  capture: PageTrackCapture;
  captureWidthPx: number;
  captureHeightPx: number;
  camera: "bubble" | "none";
  writer: PageTrackWriter;
  fetch?: typeof fetch;
  now?: () => number;
  perfNow?: () => number;
  wait?: (ms: number) => Promise<void>;
  gzip?: (text: string) => Promise<Blob>;
  report?: (error: Error, step: string) => void;
};

export type PageTrackOutcome =
  | { status: "finalized" }
  | { status: "empty" }
  | { status: "stopped"; reason: string }
  | { status: "failed"; reason: string };

type PageTrackState =
  | "idle"
  | "recording"
  | "paused"
  | "stopping"
  | "stopped"
  | "failed"
  | "discarded";

type ChunkReply =
  | { kind: "stored" }
  | { kind: "retry"; reason: string }
  | { kind: "stopped"; reason: string }
  | { kind: "rejected"; reason: string };

type ReplyBody = {
  ok?: unknown;
  error?: unknown;
  message?: unknown;
  retryable?: unknown;
  tracksStopped?: unknown;
  alreadyFinalized?: unknown;
};

export async function gzipText(text: string): Promise<Blob> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

export function isPageEventLine(line: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // coercion-ok: a line that isn't JSON isn't an rrweb event, so it is left out.
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const event = parsed as { type?: unknown; timestamp?: unknown };
  return (
    typeof event.type === "number" &&
    typeof event.timestamp === "number" &&
    Number.isFinite(event.timestamp)
  );
}

function parseReply(text: string): ReplyBody {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as ReplyBody) : {};
  } catch {
    // coercion-ok: an unreadable answer is classified by its HTTP status alone.
    return {};
  }
}

function replyReason(status: number, body: ReplyBody, text: string): string {
  const message =
    typeof body.error === "string"
      ? body.error
      : typeof body.message === "string"
        ? body.message
        : text.slice(0, 200);
  return `${status}: ${message}`;
}

export function classifyChunkReply(status: number, text: string): ChunkReply {
  const body = parseReply(text);
  if (status >= 200 && status < 300 && body.ok === true) {
    return { kind: "stored" };
  }
  const reason = replyReason(status, body, text);
  if (body.tracksStopped === true) return { kind: "stopped", reason };
  if (body.retryable === true || status >= 500) {
    return { kind: "retry", reason };
  }
  return { kind: "rejected", reason };
}

export function classifyFinalizeReply(
  status: number,
  text: string,
): ChunkReply {
  const body = parseReply(text);
  const reason = replyReason(status, body, text);
  if (status >= 200 && status < 300 && body.ok === true) {
    return body.tracksStopped === true && body.alreadyFinalized !== true
      ? { kind: "stopped", reason }
      : { kind: "stored" };
  }
  if (body.tracksStopped === true) return { kind: "stopped", reason };
  if (body.retryable === true || status >= 500) {
    return { kind: "retry", reason };
  }
  return { kind: "rejected", reason };
}

const DISCARDED = { kind: "stopped", reason: "discarded" } as const;

function retryDelayMs(baseMs: number, maxMs: number, attempt: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

export type PageTrackFinalizeInput = {
  status?: "complete" | "recovered";
  startedAtMs: number;
  durationMs: number;
  pauses: Array<{ atMs: number; wallMs: number }>;
  capture: PageTrackCapture;
  camera: "bubble" | "none";
  writer: PageTrackWriter;
  startMs: number;
  endMs: number;
  complete: boolean;
  sync: Array<[number, number]>;
};

export function buildPageTrackFinalizeBody(input: PageTrackFinalizeInput) {
  const endMs = Math.max(input.startMs, input.endMs);
  return {
    status: input.status ?? "complete",
    startedAt: new Date(input.startedAtMs).toISOString(),
    durationMs: Math.max(input.durationMs, endMs),
    writer: input.writer,
    clock: { host: "performance.now" as const, pauses: input.pauses },
    capture: { kind: input.capture, displays: [] },
    compat: {
      offsetMs: 0,
      cursor: "in-pixels" as const,
      camera: input.camera,
    },
    privacy: { keys: "none" as const, pageInputs: "visible" as const },
    tracks: [
      {
        id: "page" as const,
        startMs: input.startMs,
        endMs,
        complete: input.complete,
        meta: {
          rrweb: PAGE_TRACK_RRWEB,
          checkoutMs: PAGE_TRACK_CHECKOUT_MS,
          sync: input.sync.slice(0, MAX_SYNC_POINTS),
        },
      },
    ],
  };
}

export class PageTrack {
  private readonly options: PageTrackOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly perfNow: () => number;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly gzip: (text: string) => Promise<Blob>;
  private state: PageTrackState = "idle";
  private startedAtMs = 0;
  private startPerfMs = 0;
  private pausedPerfMs = 0;
  private pausedAtPerfMs: number | null = null;
  private pausedAtWallMs: number | null = null;
  private pauses: Array<{ atMs: number; wallMs: number }> = [];
  private sync: Array<[number, number]> = [];
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private memberTimer: ReturnType<typeof setInterval> | null = null;
  private lines: string[] = [];
  private lineChars = 0;
  private memberChain: Promise<void> = Promise.resolve();
  private outgoing = new Blob([]);
  private uploadChain: Promise<void> = Promise.resolve();
  private nextIndex = 0;
  private firstEventMs: number | null = null;
  private endMs: number | null = null;
  private incomplete = false;
  private stopReason: string | null = null;
  private draftReported = false;
  private readonly ports = new Set<PageTrackPort>();
  private stopWaiters = new Map<PageTrackPort, () => void>();
  private stopping: Promise<void> | null = null;
  private readonly aborter = new AbortController();

  constructor(options: PageTrackOptions) {
    this.options = options;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.perfNow = options.perfNow ?? (() => performance.now());
    this.wait =
      options.wait ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.gzip = options.gzip ?? gzipText;
  }

  get active(): boolean {
    return this.state === "recording" || this.state === "paused";
  }

  recorderConfig(): PageTrackRecorderConfig {
    return {
      checkoutMs: PAGE_TRACK_CHECKOUT_MS,
      capture: this.options.capture,
      captureWidthPx: this.options.captureWidthPx,
      captureHeightPx: this.options.captureHeightPx,
    };
  }

  recordingMs(perfMs = this.perfNow()): number {
    const pausedNow =
      this.pausedAtPerfMs === null ? 0 : perfMs - this.pausedAtPerfMs;
    return Math.max(
      0,
      Math.round(perfMs - this.startPerfMs - this.pausedPerfMs - pausedNow),
    );
  }

  start(startedAtMs: number): void {
    if (this.state !== "idle") return;
    this.state = "recording";
    this.startedAtMs = startedAtMs;
    this.startPerfMs = this.perfNow();
    this.addSyncPoint();
    this.syncTimer = setInterval(
      () => this.addSyncPoint(),
      PAGE_TRACK_SYNC_INTERVAL_MS,
    );
    this.memberTimer = setInterval(
      () => this.flushMember(),
      MEMBER_INTERVAL_MS,
    );
    for (const port of this.ports) this.sendStart(port);
  }

  connect(port: PageTrackPort): void {
    if (
      this.state === "stopping" ||
      this.state === "stopped" ||
      this.state === "failed" ||
      this.state === "discarded"
    ) {
      port.disconnect();
      return;
    }
    this.ports.add(port);
    port.onMessage.addListener((message) => this.receive(port, message));
    port.onDisconnect.addListener(() => {
      this.ports.delete(port);
      this.stopWaiters.get(port)?.();
    });
    if (this.active) this.sendStart(port);
  }

  pause(): void {
    if (this.state !== "recording") return;
    this.addSyncPoint();
    this.pausedAtPerfMs = this.perfNow();
    this.pausedAtWallMs = this.now();
    this.state = "paused";
    this.broadcast({ kind: "pause" });
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.closePause();
    this.state = "recording";
    this.addSyncPoint();
    this.broadcast({ kind: "resume" });
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (!this.active) {
      this.stopping = Promise.resolve();
      return this.stopping;
    }
    this.endMs = this.recordingMs();
    this.closePause();
    this.addSyncPoint();
    this.state = "stopping";
    this.clearTimers();
    const unconfirmed = new Set(this.ports);
    const waits = [...this.ports].map(
      (port) =>
        new Promise<void>((resolve) => {
          this.stopWaiters.set(port, () => {
            unconfirmed.delete(port);
            resolve();
          });
        }),
    );
    this.broadcast({ kind: "stop" });
    this.stopping = Promise.race([
      Promise.all(waits).then(() => undefined),
      this.wait(STOP_FLUSH_TIMEOUT_MS),
    ]).then(() => {
      if (unconfirmed.size > 0) this.incomplete = true;
      this.stopWaiters.clear();
      for (const port of this.ports) port.disconnect();
      this.ports.clear();
      if (this.state === "stopping") this.state = "stopped";
      this.flushMember();
    });
    return this.stopping;
  }

  discard(): void {
    this.aborter.abort();
    this.clearTimers();
    this.broadcast({ kind: "stop" });
    for (const port of this.ports) port.disconnect();
    this.ports.clear();
    this.stopWaiters.clear();
    this.state = "discarded";
    this.lines = [];
    this.lineChars = 0;
    this.outgoing = new Blob([]);
  }

  async finish(): Promise<PageTrackOutcome> {
    await this.stop();
    await this.memberChain;
    await this.uploadChain;
    const halted = this.haltedOutcome();
    if (halted) return halted;
    if (this.firstEventMs === null || this.outgoing.size === 0) {
      return { status: "empty" };
    }
    this.queueWholeChunks();
    const last = this.outgoing;
    this.outgoing = new Blob([]);
    this.queueChunk(last, true);
    await this.uploadChain;
    const outcome = this.haltedOutcome() ?? (await this.finalize());
    return this.haltedOutcome() ?? outcome;
  }

  private haltedOutcome(): PageTrackOutcome | null {
    if (this.state === "discarded") {
      return { status: "stopped", reason: "discarded" };
    }
    if (this.stopReason === null) return null;
    return this.state === "failed"
      ? { status: "failed", reason: this.stopReason }
      : { status: "stopped", reason: this.stopReason };
  }

  private queueWholeChunks(): void {
    while (this.outgoing.size > PAGE_TRACK_CHUNK_BYTES) {
      this.queueChunk(this.outgoing.slice(0, PAGE_TRACK_CHUNK_BYTES), false);
      this.outgoing = this.outgoing.slice(PAGE_TRACK_CHUNK_BYTES);
    }
  }

  private sendStart(port: PageTrackPort): void {
    try {
      port.postMessage({
        kind: "start",
        config: this.recorderConfig(),
        paused: this.state === "paused",
      });
    } catch (error) {
      this.ports.delete(port);
      this.report(error, "page-track-start");
    }
  }

  private broadcast(command: PageTrackCommand): void {
    for (const port of this.ports) {
      try {
        port.postMessage(command);
      } catch (error) {
        this.ports.delete(port);
        this.stopWaiters.get(port)?.();
        this.report(error, `page-track-${command.kind}`);
      }
    }
  }

  private receive(port: PageTrackPort, message: unknown): void {
    if (!message || typeof message !== "object") return;
    const kind = (message as { kind?: unknown }).kind;
    if (kind === "stopped") {
      this.stopWaiters.get(port)?.();
      return;
    }
    if (kind !== "events") return;
    const lines = (message as { lines?: unknown }).lines;
    if (typeof lines !== "string" || lines.length === 0) return;
    if (
      this.state !== "recording" &&
      this.state !== "paused" &&
      this.state !== "stopping"
    ) {
      return;
    }
    if (lines.length > MAX_BATCH_CHARS) {
      this.incomplete = true;
      return;
    }
    for (const line of lines.split("\n")) {
      if (!isPageEventLine(line)) {
        if (line.length > 0) this.incomplete = true;
        continue;
      }
      this.lines.push(line);
      this.lineChars += line.length + 1;
    }
    if (this.firstEventMs === null && this.lines.length > 0) {
      this.firstEventMs = this.recordingMs();
    }
    if (this.lineChars >= MEMBER_MAX_TEXT_CHARS) this.flushMember();
  }

  private closePause(): void {
    if (this.pausedAtPerfMs === null) return;
    const atMs = this.recordingMs();
    this.pausedPerfMs += this.perfNow() - this.pausedAtPerfMs;
    this.pauses.push({
      atMs,
      wallMs: Math.max(0, Math.round(this.now() - (this.pausedAtWallMs ?? 0))),
    });
    this.pausedAtPerfMs = null;
    this.pausedAtWallMs = null;
  }

  private addSyncPoint(): void {
    if (this.sync.length >= MAX_SYNC_POINTS) return;
    this.sync.push([this.now(), this.recordingMs()]);
  }

  private clearTimers(): void {
    if (this.syncTimer !== null) clearInterval(this.syncTimer);
    if (this.memberTimer !== null) clearInterval(this.memberTimer);
    this.syncTimer = null;
    this.memberTimer = null;
  }

  private flushMember(): void {
    if (this.lines.length === 0 || this.stopReason !== null) return;
    const text = `${this.lines.join("\n")}\n`;
    this.lines = [];
    this.lineChars = 0;
    this.memberChain = this.memberChain.then(async () => {
      if (this.stopReason !== null || this.state === "discarded") return;
      try {
        const member = await this.gzip(text);
        this.outgoing = new Blob([this.outgoing, member]);
      } catch (error) {
        this.incomplete = true;
        this.report(error, "page-track-gzip");
        return;
      }
      this.queueWholeChunks();
    });
  }

  private queueChunk(bytes: Blob, isFinal: boolean): void {
    const index = this.nextIndex;
    this.nextIndex += 1;
    this.uploadChain = this.uploadChain.then(async () => {
      if (this.stopReason !== null || this.state === "discarded") return;
      const reply = await this.sendChunk(bytes, index, isFinal);
      if (reply.kind === "stored") {
        if (isFinal || this.active) await this.sendDraft(isFinal);
        return;
      }
      this.halt(reply.kind === "stopped" ? "stopped" : "failed", reply.reason);
    });
  }

  private async sendChunk(
    bytes: Blob,
    index: number,
    isFinal: boolean,
  ): Promise<ChunkReply> {
    const params = new URLSearchParams({
      index: String(index),
      contentType: "application/gzip",
    });
    if (isFinal) params.set("isFinal", "1");
    const url = `${this.options.tracksUrl}/page?${params.toString()}`;
    let last: ChunkReply = { kind: "retry", reason: "not sent" };
    for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt += 1) {
      if (this.state === "discarded") return DISCARDED;
      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: this.headers("application/octet-stream"),
          credentials: "include",
          cache: "no-store",
          body: bytes,
          signal: this.requestSignal(),
        });
        last = classifyChunkReply(response.status, await response.text());
      } catch (error) {
        last = {
          kind: "retry",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      if (last.kind !== "retry") return last;
      if (attempt < CHUNK_ATTEMPTS) {
        await this.wait(
          retryDelayMs(CHUNK_RETRY_BASE_MS, CHUNK_RETRY_MAX_MS, attempt),
        );
      }
    }
    return {
      kind: "rejected",
      reason: `chunk ${index} failed ${CHUNK_ATTEMPTS} times: ${last.reason}`,
    };
  }

  private finalizeBody(
    status: "complete" | "recovered",
    endMs: number,
    complete: boolean,
  ) {
    return buildPageTrackFinalizeBody({
      status,
      startedAtMs: this.startedAtMs,
      durationMs: endMs,
      pauses: this.pauses,
      capture: this.options.capture,
      camera: this.options.camera,
      writer: this.options.writer,
      startMs: Math.min(this.firstEventMs ?? 0, endMs),
      endMs,
      complete,
      sync: this.sync,
    });
  }

  private async sendDraft(isFinal: boolean): Promise<void> {
    const body = isFinal
      ? this.finalizeBody(
          "recovered",
          this.endMs ?? this.recordingMs(),
          !this.incomplete,
        )
      : this.finalizeBody("recovered", this.recordingMs(), false);
    let reply: ChunkReply;
    try {
      const response = await this.fetchImpl(`${this.options.tracksUrl}/draft`, {
        method: "POST",
        headers: this.headers("application/json"),
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(body),
        signal: this.requestSignal(),
      });
      reply = classifyChunkReply(response.status, await response.text());
    } catch (error) {
      reply = {
        kind: "retry",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    if (
      reply.kind === "stored" ||
      this.draftReported ||
      this.state === "discarded"
    ) {
      return;
    }
    this.draftReported = true;
    this.report(
      new Error(`draft not kept: ${reply.reason}`),
      "page-track-draft",
    );
  }

  private async finalize(): Promise<PageTrackOutcome> {
    const body = this.finalizeBody(
      "complete",
      this.endMs ?? this.recordingMs(),
      !this.incomplete,
    );
    let last: ChunkReply = { kind: "retry", reason: "not sent" };
    for (let attempt = 1; attempt <= FINALIZE_ATTEMPTS; attempt += 1) {
      if (this.state === "discarded") {
        return { status: "stopped", reason: DISCARDED.reason };
      }
      try {
        const response = await this.fetchImpl(
          `${this.options.tracksUrl}/finalize`,
          {
            method: "POST",
            headers: this.headers("application/json"),
            credentials: "include",
            cache: "no-store",
            body: JSON.stringify(body),
            signal: this.requestSignal(),
          },
        );
        last = classifyFinalizeReply(response.status, await response.text());
      } catch (error) {
        last = {
          kind: "retry",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      if (last.kind === "stored") return { status: "finalized" };
      if (last.kind === "stopped") {
        return { status: "stopped", reason: last.reason };
      }
      if (last.kind === "rejected") {
        return { status: "failed", reason: last.reason };
      }
      if (attempt < FINALIZE_ATTEMPTS) {
        await this.wait(
          retryDelayMs(FINALIZE_RETRY_BASE_MS, FINALIZE_RETRY_MAX_MS, attempt),
        );
      }
    }
    return {
      status: "failed",
      reason: `finalize gave up after ${FINALIZE_ATTEMPTS} attempts: ${last.reason}`,
    };
  }

  private halt(kind: "stopped" | "failed", reason: string): void {
    if (this.state === "discarded") return;
    this.stopReason = reason;
    const wasActive = this.active;
    this.state = kind;
    this.clearTimers();
    this.lines = [];
    this.lineChars = 0;
    this.outgoing = new Blob([]);
    if (wasActive) this.broadcast({ kind: "stop" });
    for (const port of this.ports) port.disconnect();
    this.ports.clear();
    for (const resolve of this.stopWaiters.values()) resolve();
    this.stopWaiters.clear();
    if (kind === "failed") this.report(new Error(reason), "page-track-upload");
  }

  private requestSignal(): AbortSignal {
    return AbortSignal.any([
      this.aborter.signal,
      AbortSignal.timeout(CHUNK_TIMEOUT_MS),
    ]);
  }

  private headers(contentType: string): Record<string, string> {
    return {
      "Content-Type": contentType,
      "X-Agent-Native-Frontend": "1",
      ...(this.options.authToken
        ? { Authorization: `Bearer ${this.options.authToken}` }
        : {}),
    };
  }

  private report(error: unknown, step: string): void {
    this.options.report?.(
      error instanceof Error ? error : new Error(String(error)),
      step,
    );
  }
}
