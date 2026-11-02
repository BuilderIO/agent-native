import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { inflateSync } from "node:zlib";

import type { EnvHttpProxyAgent } from "undici";
import { fetch as fetchWithProxy } from "undici";

import { envProxyDispatcher } from "./http-proxy.js";

/*
 * A client for git's smart HTTP protocol, version 2, that can do just enough
 * to download chosen files from a tag without the `git` program: resolve the
 * tag, list its tree, and fetch the blobs for the paths it needs.
 * https://git-scm.com/docs/protocol-v2
 */

export const GIT_SYMLINK_MODE = "120000";
const GIT_DIRECTORY_MODE = "40000";

/** Waits before each retry; together they ride out about two minutes of outage. */
const DEFAULT_RETRY_DELAYS_MS = [
  1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000,
];
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const STALL_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 512 * 1024 * 1024;
const PROTOCOL_HEADERS = {
  "git-protocol": "version=2",
  "user-agent": "git/agent-native",
};

export interface GitTreeFile {
  /** Repository-relative and `/`-separated. */
  path: string;
  mode: string;
  oid: string;
}

export interface GitTree {
  files: GitTreeFile[];
  directories: Set<string>;
}

export interface GitHttpOptions {
  retryDelaysMs?: readonly number[];
  onRetry?: (notice: string) => void;
}

export interface GitHttpRemote {
  /** The commit a tag points at. */
  resolveTag(tag: string): Promise<string>;
  /** Every file and directory in a commit, without file contents. */
  readTree(commit: string): Promise<GitTree>;
  readFiles(
    files: readonly GitTreeFile[],
  ): Promise<{ file: GitTreeFile; content: Buffer }[]>;
}

/** The remote kept failing for reasons that waiting might fix. */
export class GitHttpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHttpUnavailableError";
  }
}

class TransientRequestError extends Error {}

interface Connection {
  url: string;
  host: string;
  dispatcher: EnvHttpProxyAgent;
  options: GitHttpOptions;
}

export async function withGitHttpRemote<T>(
  remoteUrl: string,
  options: GitHttpOptions,
  use: (remote: GitHttpRemote) => Promise<T>,
): Promise<T> {
  const connection: Connection = {
    url: remoteUrl.replace(/\/+$/, ""),
    host: new URL(remoteUrl).host,
    dispatcher: envProxyDispatcher(remoteUrl),
    options,
  };
  try {
    assertCapabilities(
      connection.url,
      await request(connection, "info/refs?service=git-upload-pack"),
    );
    return await use({
      resolveTag: (tag) => resolveTag(connection, tag),
      readTree: (commit) => readTree(connection, commit),
      readFiles: (files) => readFiles(connection, files),
    });
  } finally {
    await connection.dispatcher.close();
  }
}

async function resolveTag(
  connection: Connection,
  tag: string,
): Promise<string> {
  // The name goes into a protocol line, so it must not be able to end one.
  if (tag === "" || [...tag].some((char) => char <= " " || char === "\u007f")) {
    throw new Error(`Invalid tag name "${tag}".`);
  }
  const refName = `refs/tags/${tag}`;
  const response = await request(
    connection,
    "git-upload-pack",
    commandRequest("ls-refs", ["peel", `ref-prefix ${refName}`]),
  );
  // ref-prefix matches by prefix, so a shorter tag name lists longer ones too.
  for (const line of textLines(parsePackets(response, connection.url))) {
    const [oid, name, ...attributes] = line.split(" ");
    if (name !== refName) continue;
    const peeled = attributes.find((attribute) =>
      attribute.startsWith("peeled:"),
    );
    return expectObjectId(
      peeled ? peeled.slice("peeled:".length) : oid,
      connection.url,
    );
  }
  throw new Error(`Tag "${tag}" not found at ${connection.url}.`);
}

async function readTree(
  connection: Connection,
  commit: string,
): Promise<GitTree> {
  const objects = parseGitPack(
    await fetchPack(connection, [
      "deepen 1",
      "filter blob:none",
      `want ${commit}`,
    ]),
  );
  const commitObject = objects.get(commit);
  if (commitObject?.type !== "commit") {
    throw new Error(`${connection.url} did not send commit ${commit}.`);
  }
  const rootTree = /^tree ([0-9a-f]{40})\n/.exec(
    commitObject.data.toString("latin1"),
  )?.[1];
  if (!rootTree) {
    throw new Error(`Git commit ${commit} has no tree.`);
  }

  const files: GitTreeFile[] = [];
  const directories = new Set<string>();
  const trees = [{ oid: rootTree, path: "" }];
  // Appending while iterating walks the subtrees as they are found.
  for (const tree of trees) {
    const treeObject = objects.get(tree.oid);
    if (treeObject?.type !== "tree") {
      throw new Error(`${connection.url} did not send tree ${tree.oid}.`);
    }
    for (const entry of parseTree(treeObject.data, tree.oid)) {
      const entryPath = tree.path ? `${tree.path}/${entry.name}` : entry.name;
      if (entry.mode === GIT_DIRECTORY_MODE) {
        directories.add(entryPath);
        trees.push({ oid: entry.oid, path: entryPath });
      } else {
        files.push({ path: entryPath, mode: entry.mode, oid: entry.oid });
      }
    }
  }
  return { files, directories };
}

async function readFiles(
  connection: Connection,
  files: readonly GitTreeFile[],
): Promise<{ file: GitTreeFile; content: Buffer }[]> {
  if (files.length === 0) return [];
  const oids = [...new Set(files.map((file) => file.oid))];
  const objects = parseGitPack(
    await fetchPack(
      connection,
      oids.map((oid) => `want ${oid}`),
    ),
  );
  return files.map((file) => {
    const object = objects.get(file.oid);
    if (object?.type !== "blob") {
      throw new Error(
        `${connection.url} did not send ${file.path} (${file.oid}).`,
      );
    }
    return { file, content: object.data };
  });
}

async function fetchPack(
  connection: Connection,
  args: string[],
): Promise<Buffer> {
  const response = await request(
    connection,
    "git-upload-pack",
    commandRequest("fetch", ["no-progress", "ofs-delta", ...args, "done"]),
  );
  return packfileSection(
    parsePackets(response, connection.url),
    connection.url,
  );
}

async function request(
  connection: Connection,
  resource: string,
  body?: Buffer,
): Promise<Buffer> {
  const delays = connection.options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestOnce(connection, resource, body);
    } catch (error) {
      if (!(error instanceof TransientRequestError)) throw error;
      const delay = delays[attempt];
      if (delay === undefined) {
        throw new GitHttpUnavailableError(
          `${connection.host} is still unavailable after ${attempt + 1} attempts (${error.message}).`,
        );
      }
      connection.options.onRetry?.(
        `${connection.host} is unavailable (${error.message}); retrying in ${Math.ceil(delay / 1000)}s.`,
      );
      await sleep(delay);
    }
  }
}

async function requestOnce(
  connection: Connection,
  resource: string,
  body: Buffer | undefined,
): Promise<Buffer> {
  const url = `${connection.url}/${resource}`;
  const controller = new AbortController();
  // Aborts a transfer that stops moving without capping one that is slow.
  const stall = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
  const transportError = (error: unknown) =>
    controller.signal.aborted
      ? new TransientRequestError(`no data for ${STALL_TIMEOUT_MS / 1000}s`)
      : networkError(error);
  try {
    let response;
    try {
      response = await fetchWithProxy(url, {
        ...(body
          ? {
              method: "POST",
              body,
              headers: {
                ...PROTOCOL_HEADERS,
                accept: "application/x-git-upload-pack-result",
                "content-type": "application/x-git-upload-pack-request",
              },
            }
          : { method: "GET", headers: PROTOCOL_HEADERS }),
        dispatcher: connection.dispatcher,
        signal: controller.signal,
      });
    } catch (error) {
      throw transportError(error);
    }
    if (!response.ok) {
      await response.body?.cancel();
      const message = `HTTP ${response.status}`;
      throw RETRYABLE_STATUSES.has(response.status)
        ? new TransientRequestError(message)
        : new Error(`${url} answered ${message}.`);
    }
    if (!response.body) {
      throw new Error(`${url} returned an empty response.`);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (error) {
        throw transportError(error);
      }
      if (chunk.done) break;
      stall.refresh();
      received += chunk.value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(
          `${url} sent more than the ${MAX_RESPONSE_BYTES}-byte limit.`,
        );
      }
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(stall);
  }
}

function networkError(error: unknown): Error {
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  const message = cause instanceof Error ? cause.message : String(cause);
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? String(cause.code)
      : "";
  // A certificate problem will not fix itself while we wait.
  return /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)
    ? new Error(message)
    : new TransientRequestError(message);
}

function assertCapabilities(url: string, response: Buffer): void {
  const lines = textLines(parsePackets(response, url));
  // GitHub opens with the smart HTTP service banner; git http-backend omits
  // it for version 2.
  const start = lines[0]?.startsWith("# service=") ? 1 : 0;
  if (lines[start] !== "version 2") {
    throw new Error(`${url} does not support git protocol version 2.`);
  }
  const capabilities = new Map(
    lines.slice(start + 1).map((line) => {
      const separator = line.indexOf("=");
      return separator < 0
        ? [line, ""]
        : [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
  const fetchFeatures = capabilities.get("fetch")?.split(" ");
  const objectFormat = capabilities.get("object-format");
  if (
    !capabilities.has("ls-refs") ||
    !fetchFeatures?.includes("shallow") ||
    !fetchFeatures.includes("filter") ||
    (objectFormat !== undefined && objectFormat !== "sha1")
  ) {
    throw new Error(
      `${url} does not support partial fetches (ls-refs, fetch with shallow and filter, SHA-1 objects).`,
    );
  }
}

function expectObjectId(value: string | undefined, source: string): string {
  if (value === undefined || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${source} sent a malformed object id "${value}".`);
  }
  return value;
}

/* ─────────────────────────────────────────────────────────────────────────
 * pkt-line framing
 * ───────────────────────────────────────────────────────────────────────── */

type Packet =
  | { type: "flush" | "delimiter" | "response-end" }
  | { type: "data"; data: Buffer };

const FLUSH_PACKET = Buffer.from("0000");
const DELIMITER_PACKET = Buffer.from("0001");

function packetLine(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const length = (payload.length + 4).toString(16).padStart(4, "0");
  return Buffer.concat([Buffer.from(length, "latin1"), payload]);
}

function commandRequest(command: string, args: string[]): Buffer {
  return Buffer.concat([
    packetLine(`command=${command}\n`),
    DELIMITER_PACKET,
    ...args.map((arg) => packetLine(`${arg}\n`)),
    FLUSH_PACKET,
  ]);
}

function parsePackets(buffer: Buffer, source: string): Packet[] {
  const packets: Packet[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const header = buffer.toString("latin1", offset, offset + 4);
    const length = /^[0-9a-f]{4}$/.test(header)
      ? Number.parseInt(header, 16)
      : Number.NaN;
    if (
      Number.isNaN(length) ||
      length === 3 ||
      offset + Math.max(length, 4) > buffer.length
    ) {
      throw new Error(`${source} sent a malformed git protocol response.`);
    }
    if (length < 4) {
      packets.push({
        type:
          length === 0 ? "flush" : length === 1 ? "delimiter" : "response-end",
      });
      offset += 4;
      continue;
    }
    const data = buffer.subarray(offset + 4, offset + length);
    if (data.toString("latin1", 0, 4) === "ERR ") {
      throw new Error(`${source}: ${data.toString("utf8", 4).trim()}`);
    }
    packets.push({ type: "data", data });
    offset += length;
  }
  return packets;
}

function textLines(packets: Packet[]): string[] {
  return packets.flatMap((packet) =>
    packet.type === "data"
      ? [packet.data.toString("utf8").replace(/\n$/, "")]
      : [],
  );
}

/** The pack data from a fetch response, unwrapped from its side-band frames. */
function packfileSection(packets: Packet[], source: string): Buffer {
  let atSectionStart = true;
  let inPackfile = false;
  const chunks: Buffer[] = [];
  for (const packet of packets) {
    if (packet.type !== "data") {
      if (inPackfile) return Buffer.concat(chunks);
      atSectionStart = true;
      continue;
    }
    if (inPackfile) {
      const band = packet.data[0];
      if (band === 1) {
        chunks.push(packet.data.subarray(1));
      } else if (band === 3) {
        throw new Error(`${source}: ${packet.data.toString("utf8", 1).trim()}`);
      } else if (band !== 2) {
        throw new Error(`${source} sent an unknown side-band channel ${band}.`);
      }
    } else if (atSectionStart) {
      inPackfile = packet.data.toString("utf8") === "packfile\n";
      atSectionStart = false;
    }
  }
  throw new Error(
    inPackfile
      ? `${source} ended its response before the packfile finished.`
      : `${source} sent no packfile.`,
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Packfiles and objects
 * https://git-scm.com/docs/gitformat-pack
 * ───────────────────────────────────────────────────────────────────────── */

export interface GitObject {
  type: "commit" | "tree" | "blob" | "tag";
  data: Buffer;
}

const OBJECT_TYPES: Record<number, GitObject["type"] | undefined> = {
  1: "commit",
  2: "tree",
  3: "blob",
  4: "tag",
};
const OFS_DELTA = 6;
const REF_DELTA = 7;

interface PackDelta {
  offset: number;
  base: { offset: number } | { oid: string };
  data: Buffer;
}

/** Decodes a self-contained packfile into its objects, keyed by object id. */
export function parseGitPack(pack: Buffer): Map<string, GitObject> {
  if (pack.length < 32 || pack.toString("latin1", 0, 4) !== "PACK") {
    throw new Error("Not a git packfile.");
  }
  const version = pack.readUInt32BE(4);
  if (version !== 2 && version !== 3) {
    throw new Error(`Unsupported git packfile version ${version}.`);
  }
  const body = pack.subarray(0, pack.length - 20);
  const checksum = createHash("sha1").update(body).digest();
  if (!checksum.equals(pack.subarray(pack.length - 20))) {
    throw new Error("Git packfile checksum does not match its contents.");
  }

  const objects = new Map<string, GitObject>();
  const objectsByOffset = new Map<number, GitObject>();
  const store = (offset: number, object: GitObject) => {
    objectsByOffset.set(offset, object);
    objects.set(objectId(object), object);
  };

  let deltas: PackDelta[] = [];
  let offset = 12;
  const nextByte = () => {
    if (offset >= body.length) {
      throw new Error("Git packfile ends in the middle of an object.");
    }
    const byte = body.readUInt8(offset);
    offset += 1;
    return byte;
  };
  for (let index = pack.readUInt32BE(8); index > 0; index -= 1) {
    const start = offset;
    let byte = nextByte();
    const typeCode = (byte >> 4) & 0b111;
    let size = byte & 0b1111;
    for (let shift = 4; byte & 0x80; shift += 7) {
      byte = nextByte();
      size += (byte & 0x7f) * 2 ** shift;
    }

    let base: PackDelta["base"] | undefined;
    if (typeCode === OFS_DELTA) {
      byte = nextByte();
      let distance = byte & 0x7f;
      while (byte & 0x80) {
        byte = nextByte();
        distance = (distance + 1) * 128 + (byte & 0x7f);
      }
      base = { offset: start - distance };
    } else if (typeCode === REF_DELTA) {
      if (offset + 20 > body.length) {
        throw new Error("Git packfile ends in the middle of an object.");
      }
      base = { oid: body.toString("hex", offset, offset + 20) };
      offset += 20;
    }

    const { data, consumed } = inflateEntry(body, offset, size);
    offset += consumed;
    if (base) {
      deltas.push({ offset: start, base, data });
      continue;
    }
    const type = OBJECT_TYPES[typeCode];
    if (!type) {
      throw new Error(`Git packfile has an unknown object type ${typeCode}.`);
    }
    store(start, { type, data });
  }
  if (offset !== body.length) {
    throw new Error("Git packfile has data after its last object.");
  }

  // A delta's base can itself be a delta stored later in the pack.
  while (deltas.length > 0) {
    const unresolved: PackDelta[] = [];
    for (const delta of deltas) {
      const base =
        "offset" in delta.base
          ? objectsByOffset.get(delta.base.offset)
          : objects.get(delta.base.oid);
      if (base) {
        store(delta.offset, {
          type: base.type,
          data: applyDelta(base.data, delta.data),
        });
      } else {
        unresolved.push(delta);
      }
    }
    if (unresolved.length === deltas.length) {
      throw new Error("Git packfile has deltas against objects it lacks.");
    }
    deltas = unresolved;
  }
  return objects;
}

function inflateEntry(
  body: Buffer,
  offset: number,
  size: number,
): { data: Buffer; consumed: number } {
  // Only `info` reports how much input the stream used, which is the only
  // way to find where the next object starts.
  const result = inflateSync(body.subarray(offset), {
    info: true,
    maxOutputLength: Math.max(size, 1),
  }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
  if (result.buffer.length !== size) {
    throw new Error("Git packfile object is not the size its header says.");
  }
  return { data: result.buffer, consumed: result.engine.bytesWritten };
}

function applyDelta(base: Buffer, delta: Buffer): Buffer {
  let offset = 0;
  const nextByte = () => {
    if (offset >= delta.length) throw new Error("Git delta is truncated.");
    const byte = delta.readUInt8(offset);
    offset += 1;
    return byte;
  };
  const nextSize = () => {
    let size = 0;
    for (let shift = 0, byte = 0x80; byte & 0x80; shift += 7) {
      byte = nextByte();
      size += (byte & 0x7f) * 2 ** shift;
    }
    return size;
  };

  if (nextSize() !== base.length) {
    throw new Error("Git delta does not match the size of its base.");
  }
  const result = Buffer.alloc(nextSize());
  let written = 0;
  while (offset < delta.length) {
    const instruction = nextByte();
    let start: number;
    let length: number;
    let source: Buffer;
    if (instruction & 0x80) {
      start = 0;
      length = 0;
      for (let bit = 0; bit < 4; bit += 1) {
        if (instruction & (1 << bit)) start += nextByte() * 2 ** (8 * bit);
      }
      for (let bit = 0; bit < 3; bit += 1) {
        if (instruction & (0x10 << bit)) length += nextByte() * 2 ** (8 * bit);
      }
      if (length === 0) length = 0x10000;
      source = base;
    } else if (instruction !== 0) {
      start = offset;
      length = instruction;
      source = delta;
      offset += length;
    } else {
      throw new Error("Git delta uses the reserved instruction 0.");
    }
    if (start + length > source.length || written + length > result.length) {
      throw new Error("Git delta reaches outside its base or result.");
    }
    written += source.copy(result, written, start, start + length);
  }
  if (written !== result.length) {
    throw new Error("Git delta result is shorter than it declares.");
  }
  return result;
}

function objectId(object: GitObject): string {
  return createHash("sha1")
    .update(`${object.type} ${object.data.length}\0`)
    .update(object.data)
    .digest("hex");
}

function parseTree(
  data: Buffer,
  oid: string,
): { mode: string; name: string; oid: string }[] {
  const entries: { mode: string; name: string; oid: string }[] = [];
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    const nul = space < 0 ? -1 : data.indexOf(0, space);
    if (nul < 0 || nul + 21 > data.length) {
      throw new Error(`Git tree ${oid} is malformed.`);
    }
    const name = data.toString("utf8", space + 1, nul);
    if (name === "" || name === "." || name === ".." || /[/\\]/.test(name)) {
      throw new Error(`Git tree ${oid} has an unsafe entry name "${name}".`);
    }
    entries.push({
      mode: data.toString("latin1", offset, space),
      name,
      oid: data.toString("hex", nul + 1, nul + 21),
    });
    offset = nul + 21;
  }
  return entries;
}
