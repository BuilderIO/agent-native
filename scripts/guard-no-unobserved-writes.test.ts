import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findUnobservedWrites,
  isUnobservedWriteScopePath,
} from "./guard-no-unobserved-writes.js";

const FILE = "templates/mail/actions/sync-drafts.ts";

function allLines(source: string) {
  return new Set(source.split("\n").map((_, index) => index + 1));
}

function flagged(source: string, added = allLines(source)) {
  return findUnobservedWrites(FILE, source, added).map(
    (finding) => `${finding.line}:${finding.channel}`,
  );
}

describe("unobserved write guard: filesystem writes", () => {
  it("flags disk writes and deletes through bare names, namespaces and this.fs", () => {
    const source = [
      'import { writeFile } from "node:fs/promises";',
      "await writeFile(path, body);",
      "await fs.promises.rm(dir, { recursive: true });",
      "await fsp.rename(a, b);",
      "fs.appendFileSync(log, line);",
      "const out = createWriteStream(file);",
      "mkdirSync(dir, { recursive: true });",
      "this.fs.copyFileSync(a, b);",
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "2:local-disk",
      "3:local-disk",
      "4:local-disk",
      "5:local-disk",
      "6:local-disk",
      "7:local-disk",
      "8:local-disk",
    ]);
  });

  it("matches ordinary-word fs names only as a namespace call", () => {
    const helpers = [
      "const short = truncate(text, 120);",
      "return truncate(serialized, MAX);",
    ].join("\n");
    assert.deepEqual(flagged(helpers), []);

    const namespaced = [
      "fs.truncateSync(path, 0);",
      "await fsp.symlink(target, link);",
    ].join("\n");
    assert.deepEqual(flagged(namespaced), ["1:local-disk", "2:local-disk"]);
  });

  it("flags writes through an import alias, a namespace import or a file handle", () => {
    const source = [
      'import { writeFile as persist, rm as remove } from "node:fs/promises";',
      'import * as disk from "node:fs";',
      'import nodeFs, { truncate } from "fs";',
      "await persist(path, body);",
      "await remove(dir);",
      "disk.writeFileSync(path, body);",
      "nodeFs.rmSync(dir);",
      "await truncate(path, 0);",
      'const handle = await fsp.open(path, "w");',
      "await handle.writeFile(body);",
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "4:local-disk",
      "5:local-disk",
      "6:local-disk",
      "7:local-disk",
      "8:local-disk",
      "9:local-disk",
      "10:local-disk",
    ]);
  });

  it("flags fs.write and writev, and the write methods of a file handle opened from fs", () => {
    const source = [
      'import * as fs from "node:fs";',
      'import { open } from "node:fs/promises";',
      "fs.write(fd, buffer);",
      "fs.writevSync(fd, buffers);",
      "fs.chmodSync(path, 0o600);",
      'const handle = await open(path, "w");',
      "await handle.write(buffer);",
      "await handle.truncate(0);",
      "await handle.writev(buffers);",
      'const stream = await fsp.open(path, "a");',
      "await stream.write(chunk);",
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "3:local-disk",
      "4:local-disk",
      "5:local-disk",
      "6:local-disk",
      "7:local-disk",
      "8:local-disk",
      "9:local-disk",
      "10:local-disk",
      "11:local-disk",
    ]);
  });

  it("treats an fs open that can create or truncate as a write, and a read-only open as none", () => {
    const source = [
      'import { open, openSync } from "node:fs";',
      'import * as fsp from "node:fs/promises";',
      'const a = await fsp.open(path, "w");',
      'const b = await fsp.open(path, "r+");',
      "const c = openSync(path, flags);",
      'const d = await fsp.open(path, "r");',
      "const e = await fsp.open(path);",
      "open(path, (error, fd) => done(fd));",
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "3:local-disk",
      "4:local-disk",
      "5:local-disk",
    ]);
  });

  it("flags a write method called directly on an opened handle, and on a handle typed FileHandle", () => {
    const source = [
      'import type { FileHandle } from "node:fs/promises";',
      'await (await fsp.open(path, "r")).write(buffer);',
      "async function writeAll(handle: FileHandle, data: Buffer) {",
      "  await handle.write(data);",
      "}",
      "async function readAll(socket: Socket) {",
      "  await socket.write(data);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), ["2:local-disk", "4:local-disk"]);
  });

  it("follows require and dynamic import bindings of the fs module", () => {
    const source = [
      'const disk = require("node:fs");',
      'const { writeFile: persist } = require("fs");',
      'const fs2 = await import("node:fs/promises");',
      "disk.writeFileSync(path, data);",
      "await persist(path, data);",
      "await fs2.rm(path);",
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "4:local-disk",
      "5:local-disk",
      "6:local-disk",
    ]);
  });

  it("does not flag write on a stream, response or a socket that is not an fs handle", () => {
    const source = [
      "res.write(chunk);",
      "process.stdout.write(text);",
      "const socket = net.open(port);",
      "socket.write(data);",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("does not flag a same-named function imported from another module", () => {
    const source = [
      'import { writeFile as persist } from "./store";',
      "await persist(path, body);",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("does not flag method calls on unrelated objects or names that only contain a write name", () => {
    const source = [
      "const matches = regex.exec(text);",
      "const ok = confirm(message);",
      "const storm = form(values);",
      "const count = counter.cp(3);",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });
});

describe("unobserved write guard: child processes", () => {
  it("flags child-process calls only in a file that imports child_process", () => {
    const source = [
      'import { execFile, spawnSync } from "node:child_process";',
      'await execFile("git", ["status"]);',
      'spawnSync("ls");',
    ].join("\n");

    assert.deepEqual(flagged(source), ["2:child-process", "3:child-process"]);
  });

  it("flags a namespace import's calls and ignores spawn without the import", () => {
    const namespace = [
      'import * as cp from "node:child_process";',
      'cp.spawn("git", ["status"]);',
    ].join("\n");
    assert.deepEqual(flagged(namespace), ["2:child-process"]);

    assert.deepEqual(flagged('spawn("ls");\nexec("ls");'), []);
  });

  it("flags a call through an import alias", () => {
    const source = [
      'import { spawn as launch } from "node:child_process";',
      'launch("git", ["status"]);',
    ].join("\n");

    assert.deepEqual(flagged(source), ["2:child-process"]);
  });
});

describe("unobserved write guard: HTTP clients and vendor SDKs", () => {
  it("flags node http clients by import and by request call, but not type-only imports", () => {
    const source = [
      'import axios from "axios";',
      'import type { IncomingMessage } from "node:http";',
      'import { request } from "node:https";',
      'https.request({ method: "POST" }, () => {});',
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "1:node-http",
      "3:node-http",
      "4:node-http",
    ]);
  });

  it("flags vendor SDK imports for every listed family and skips look-alike packages", () => {
    const source = [
      'import Stripe from "stripe";',
      'import { google } from "googleapis";',
      'import { WebClient } from "@slack/web-api";',
      'import { S3Client } from "@aws-sdk/client-s3";',
      'import { Storage } from "@google-cloud/storage";',
      'import { put } from "@vercel/blob";',
      'import { getStore } from "@netlify/blobs";',
      'import { createClient } from "@supabase/supabase-js";',
      'import Pusher from "pusher-js";',
      'import { z } from "zod";',
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "1:vendor-sdk",
      "2:vendor-sdk",
      "3:vendor-sdk",
      "4:vendor-sdk",
      "5:vendor-sdk",
      "6:vendor-sdk",
      "7:vendor-sdk",
      "8:vendor-sdk",
    ]);
  });

  it("does not flag fetch, which the framework observes", () => {
    const source = [
      'const response = await fetch(url, { method: "POST", body });',
      'await fetch(url, { method: "DELETE" });',
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });
});

describe("unobserved write guard: passes", () => {
  it("passes a flagged line that carries the pragma with a reason, on it or on the line above", () => {
    const source = [
      "// observed-write-ok: scratch file in a temp dir, removed before return",
      "await writeFile(scratch, body);",
      "await rm(scratch); // observed-write-ok: removes only the scratch file above",
      "const spacer = 1;",
      "// observed-write-ok: reason here",
      "const note = 2;",
      "await unlink(stale);",
    ].join("\n");

    assert.deepEqual(flagged(source), ["7:local-disk"]);
  });

  it("does not accept an empty pragma reason and says so", () => {
    const source = ["// observed-write-ok:", "await unlink(stale);"].join("\n");

    const [finding] = findUnobservedWrites(FILE, source, allLines(source));
    assert.equal(finding.line, 2);
    assert.equal(finding.emptyPragma, true);
  });

  it("passes every write that follows a noteExternalWrite in its own function", () => {
    const source = [
      'import { noteExternalWrite } from "@agent-native/core/action";',
      "export async function save(path, body, old) {",
      '  noteExternalWrite("local-disk");',
      "  await writeFile(path, body);",
      "  await rm(old);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("passes a write in a callback or branch of the function that noted it", () => {
    const source = [
      "export async function prune(paths) {",
      '  noteExternalWrite("local-disk");',
      "  for (const p of paths) {",
      "    if (p) await rm(p);",
      "  }",
      "  paths.forEach((p) => unlinkSync(p));",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("passes a module-level write that follows a module-level note", () => {
    const source = [
      'noteExternalWrite("local-disk");',
      "mkdirSync(dir, { recursive: true });",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("does not let a module-level note cover a write inside a function", () => {
    const source = [
      'noteExternalWrite("local-disk");',
      "export async function save(path) {",
      "  await writeFile(path, body);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), ["3:local-disk"]);
  });

  it("does not let a note in one function cover a write in another", () => {
    const source = [
      "export async function noted(path) {",
      '  noteExternalWrite("local-disk");',
      "  await writeFile(path, body);",
      "}",
      "export async function other(path) {",
      "  await writeFile(path, body);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), ["6:local-disk"]);
  });

  it("does not let a note after a write, or inside a callback beside it, cover it", () => {
    const source = [
      "export async function late(path) {",
      "  await writeFile(path, body);",
      '  noteExternalWrite("local-disk");',
      "}",
      "export async function beside(paths) {",
      '  paths.forEach(() => noteExternalWrite("local-disk"));',
      "  await rm(paths[0]);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), ["2:local-disk", "7:local-disk"]);
  });

  it("does not let a note that runs only on some paths cover a write", () => {
    const source = [
      "export async function ifOnly(path, flag) {",
      '  if (flag) noteExternalWrite("local-disk");',
      "  await writeFile(path, body);",
      "}",
      "export async function and(path, flag) {",
      '  flag && noteExternalWrite("local-disk");',
      "  await writeFile(path, body);",
      "}",
      "export async function ternary(path, flag) {",
      '  flag ? noteExternalWrite("local-disk") : undefined;',
      "  await writeFile(path, body);",
      "}",
      "export async function braced(path, flag) {",
      '  if (flag) { noteExternalWrite("local-disk"); }',
      "  await writeFile(path, body);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "3:local-disk",
      "7:local-disk",
      "11:local-disk",
      "15:local-disk",
    ]);
  });

  it("covers a write that follows its note in the same branch and no other", () => {
    const source = [
      "export async function save(path, flag) {",
      "  if (flag) {",
      '    noteExternalWrite("local-disk");',
      "    await writeFile(path, body);",
      "  } else {",
      "    await rm(path);",
      "  }",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), ["6:local-disk"]);
  });

  it("compares a note with where the write call starts, not with its line", () => {
    const source = [
      "export async function late(path) {",
      '  await writeFile(path, body); noteExternalWrite("local-disk");',
      "}",
      "export async function early(path) {",
      '  noteExternalWrite("local-disk"); await writeFile(path, body);',
      "}",
      "export async function commented(path) {",
      '  /* a comment that is longer than the call after it */ noteExternalWrite("local-disk"); await rm(path);',
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), ["2:local-disk"]);
  });

  it("lets a note anywhere in the file cover an HTTP client or vendor SDK import", () => {
    const source = [
      'import Stripe from "stripe";',
      'import axios from "axios";',
      "export async function charge() {",
      '  noteExternalWrite("vendor-sdk");',
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
    assert.deepEqual(flagged(source.split("\n").slice(0, 2).join("\n")), [
      "1:vendor-sdk",
      "2:node-http",
    ]);
  });

  it("passes a write that follows a call to a helper in the file that makes the note", () => {
    const source = [
      "async function noteDiskWrite() {",
      '  noteExternalWrite("local-disk");',
      "}",
      "const markWrite = () => noteDiskWrite();",
      "export async function save(path, body) {",
      "  await markWrite();",
      "  await writeFile(path, body);",
      "}",
      "export async function prune(path) {",
      "  await noteDiskWrite();",
      "  await rm(path);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("does not pass a write on a helper that makes no note, or that is called after it", () => {
    const source = [
      "async function logWrite() {",
      '  console.log("writing");',
      "}",
      "async function noteDiskWrite() {",
      '  noteExternalWrite("local-disk");',
      "}",
      "export async function plain(path) {",
      "  await logWrite();",
      "  await writeFile(path, body);",
      "}",
      "export async function late(path) {",
      "  await writeFile(path, body);",
      "  await noteDiskWrite();",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), ["9:local-disk", "12:local-disk"]);
  });

  it("does not treat a helper that notes only on some paths as one that notes", () => {
    const source = [
      "async function maybeNote(flag) {",
      '  if (flag) noteExternalWrite("local-disk");',
      "}",
      "export async function save(path) {",
      "  await maybeNote(true);",
      "  await writeFile(path, body);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), ["6:local-disk"]);
  });

  it("does not credit a helper that can return before its note, or an unawaited call to one that notes after an await", () => {
    const source = [
      "async function skipping(skip) {",
      "  if (skip) return;",
      '  noteExternalWrite("local-disk");',
      "}",
      "async function delayed() {",
      "  await ready();",
      '  noteExternalWrite("local-disk");',
      "}",
      "export async function a(path) {",
      "  await skipping(false);",
      "  await writeFile(path, body);",
      "}",
      "export async function b(path) {",
      "  delayed();",
      "  await writeFile(path, body);",
      "}",
      "export async function c(path) {",
      "  await delayed();",
      "  await writeFile(path, body);",
      "}",
      "async function outer() {",
      "  await delayed();",
      "}",
      "export async function d(path) {",
      "  outer();",
      "  await writeFile(path, body);",
      "}",
      "export async function e(path) {",
      "  await outer();",
      "  await writeFile(path, body);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "11:local-disk",
      "15:local-disk",
      "26:local-disk",
    ]);
  });

  it("credits an async helper that notes before its first await, even when the caller does not await it", () => {
    const source = [
      "async function noteDiskWrite() {",
      '  noteExternalWrite("local-disk");',
      "  await flush();",
      "}",
      "export async function save(path) {",
      "  noteDiskWrite();",
      "  await writeFile(path, body);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("does not let a note outside a hoisted declaration cover a write inside it", () => {
    const source = [
      "export async function save(path) {",
      "  await run();",
      '  noteExternalWrite("local-disk");',
      "  function run() {",
      "    return writeFile(path, body);",
      "  }",
      "}",
      "export async function safe(path) {",
      "  async function run() {",
      '    noteExternalWrite("local-disk");',
      "    return writeFile(path, body);",
      "  }",
      "  await run();",
      "}",
      "export async function arrow(path) {",
      '  noteExternalWrite("local-disk");',
      "  const run = () => writeFile(path, body);",
      "  await run();",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), ["5:local-disk"]);
  });

  it("does not resolve a helper name that the file declares twice", () => {
    const source = [
      "async function noteDiskWrite() {",
      '  noteExternalWrite("local-disk");',
      "}",
      "export async function shadowed(path, noteDiskWrite) {",
      "  await noteDiskWrite();",
      "  await writeFile(path, body);",
      "}",
      "export async function plain(path) {",
      "  await noteDiskWrite();",
      "  await writeFile(path, body);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), ["6:local-disk", "10:local-disk"]);
  });

  it("counts only the framework's noteExternalWrite: an alias, a namespace, a dynamic import, not a logger", () => {
    const source = [
      'import { noteExternalWrite as noted } from "@agent-native/core/action";',
      "export async function viaAlias(path) {",
      '  noted("local-disk");',
      "  await writeFile(path, body);",
      "}",
      "export async function viaLogger(path) {",
      '  logger.noteExternalWrite("local-disk");',
      "  await writeFile(path, body);",
      "}",
      "export async function viaDynamic(path) {",
      '  const { noteExternalWrite: mark } = await import("@agent-native/core/action");',
      '  mark("local-disk");',
      "  await writeFile(path, body);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), ["8:local-disk"]);
  });

  it("does not count a noteExternalWrite the file declares or imports from elsewhere", () => {
    const local = [
      "function noteExternalWrite() {}",
      "export async function save(path) {",
      '  noteExternalWrite("local-disk");',
      "  await writeFile(path, body);",
      "}",
    ].join("\n");
    assert.deepEqual(flagged(local), ["4:local-disk"]);

    const foreign = [
      'import { noteExternalWrite } from "./my-logger";',
      "export async function save(path) {",
      '  noteExternalWrite("local-disk");',
      "  await writeFile(path, body);",
      "}",
    ].join("\n");
    assert.deepEqual(flagged(foreign), ["4:local-disk"]);
  });

  it("accepts a note called through a namespace", () => {
    const source = [
      'import * as core from "@agent-native/core/action";',
      "export async function save(path, body) {",
      '  core.noteExternalWrite("local-disk");',
      "  await writeFile(path, body);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("does not count a noteExternalWrite spelled in a comment or string", () => {
    const source = [
      '// noteExternalWrite("local-disk") goes here someday',
      'const hint = "call noteExternalWrite(\\"x\\") first";',
      "await writeFile(path, body);",
    ].join("\n");

    assert.deepEqual(flagged(source), ["3:local-disk"]);
  });

  it("reports only lines this branch added", () => {
    const source = ["const a = 1;", "await writeFile(path, body);"].join("\n");

    assert.deepEqual(flagged(source, new Set([1])), []);
    assert.deepEqual(flagged(source, new Set([2])), ["2:local-disk"]);
  });
});

describe("unobserved write guard: comments and strings are not code", () => {
  it("does not flag a line comment, block comment, JSDoc line or string text", () => {
    const source = [
      "// await writeFile(path, body);",
      "/* rm(dir) */",
      "/**",
      ' * fs.writeFile(p) and spawn("x") are documented here',
      " */",
      'const hint = "call writeFile(path) to save";',
      "const label = `rm(${dir})`;",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("still flags a call inside a template expression", () => {
    const source = "const path = `${await writeFile(name, body)}`;";

    assert.deepEqual(flagged(source), ["1:local-disk"]);
  });
});

describe("unobserved write guard scope", () => {
  it("covers action, server and shared source in templates, and dispatch and scheduling source", () => {
    for (const rel of [
      "templates/mail/actions/sync-drafts.ts",
      "templates/mail/server/lib/cache.ts",
      "templates/plan/shared/store.ts",
      "templates/plan/server/nested/writer.tsx",
      "packages/dispatch/src/server/export.ts",
      "packages/dispatch/src/client/page.tsx",
      "packages/scheduling/src/runner.ts",
    ]) {
      assert.equal(isUnobservedWriteScopePath(rel), true, rel);
    }
  });

  it("skips tests, specs, template UI, core, apps, scripts and other file types", () => {
    for (const rel of [
      "templates/mail/actions/sync-drafts.spec.ts",
      "templates/mail/actions/sync-drafts.test.ts",
      "templates/mail/actions/__tests__/sync.ts",
      "templates/mail/app/routes/index.tsx",
      "packages/dispatch/src/server/export.test.ts",
      "packages/core/src/outbound-write-observation.ts",
      "apps/demo/actions/do-thing.ts",
      "scripts/guard-no-unobserved-writes.ts",
      "templates/mail/actions/readme.md",
    ]) {
      assert.equal(isUnobservedWriteScopePath(rel), false, rel);
    }
  });
});

describe("guard command", () => {
  it("exits 2, not 0, when it cannot determine the added lines", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve(import.meta.dirname, "guard-no-unobserved-writes.ts"),
      ],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          GUARD_DIFF_BASE: "origin/branch-that-does-not-exist-for-this-test",
        },
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /could not determine which lines/);
  });
});
