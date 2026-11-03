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

  it("passes every flagged line in a file that calls noteExternalWrite", () => {
    const source = [
      'import { noteExternalWrite } from "@agent-native/core/action";',
      'noteExternalWrite("local-disk");',
      "await writeFile(path, body);",
      "await rm(old);",
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
      "packages/core/src/server/outbound-write-observation.ts",
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
