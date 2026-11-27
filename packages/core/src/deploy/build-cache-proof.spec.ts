import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { patchCloudflareModuleServerOutput } from "./build.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
    ".tmp",
  );
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "worker-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("patchCloudflareModuleServerOutput cache proof", () => {
  it("reloads original sources after eviction and rewrites both consumers", async () => {
    const requireFromWrangler = createRequire(
      createRequire(import.meta.url).resolve("wrangler/package.json"),
    );
    const { Miniflare } = requireFromWrangler("miniflare") as {
      Miniflare: new (options: {
        modules: boolean;
        scriptPath: string;
        modulesRoot: string;
        compatibilityDate: string;
        compatibilityFlags: string[];
      }) => {
        dispatchFetch(url: string): Promise<Response>;
        dispose(): Promise<void>;
      };
    };
    const dir = makeTempDir();
    const relayNames = Array.from({ length: 16 }, (_, i) => `relay-${i}.mjs`);
    for (let i = 0; i < relayNames.length; i++) {
      fs.writeFileSync(
        path.join(dir, relayNames[i]),
        `${i === 7 ? 'export * from "./relay-0.mjs";\n' : ""}export * from "./relay-${(i + 1) % 16}.mjs";${
          i === 15
            ? '\nexport { createRequire as factory } from "node:module";'
            : ""
        }`,
      );
    }
    const shared = path.join(dir, "shared.mjs");
    const sharedSource = `import {factory} from "./relay-0.mjs";
       import process from "node:process";
       export {factory};
       export function check() { return factory(import.meta.url)("process") === process; }`;
    fs.writeFileSync(shared, sharedSource);
    const early = path.join(dir, "early.mjs");
    fs.writeFileSync(
      early,
      `import {factory} from "./shared.mjs";
       import process from "node:process";
       export function checkEarly() { return factory(import.meta.url)("node:process") === process; }`,
    );
    const entry = path.join(dir, "late-worker.mjs");
    fs.writeFileSync(
      entry,
      `import {factory, check} from "./shared.mjs";
       import {checkEarly} from "./early.mjs";
       import process from "node:process";
       export default {fetch() {return Response.json({
         shared: check(),
         early: checkEarly(),
         consumer: factory(import.meta.url)("node:process") === process,
         buffer: typeof factory(import.meta.url)("node:buffer").Buffer,
       });}};`,
    );
    const churnNames = Array.from({ length: 12 }, (_, i) => `churn-${i}.mjs`);
    const moduleNames = Array.from({ length: 12 }, (_, i) => `module-${i}.mjs`);
    for (let i = 0; i < churnNames.length; i++) {
      fs.writeFileSync(
        path.join(dir, churnNames[i]),
        `import {factory} from "./${moduleNames[i]}"; factory(import.meta.url)("process");`,
      );
      fs.writeFileSync(
        path.join(dir, moduleNames[i]),
        'export { createRequire as factory } from "node:module";',
      );
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const order = [
      "early.mjs",
      "shared.mjs",
      ...churnNames,
      "late-worker.mjs",
      ...relayNames,
      ...moduleNames,
    ];
    const orderedEntries = order.map((name) => {
      const entry = entries.find((item) => item.name === name);
      if (!entry) throw new Error(`Missing fixture module ${name}`);
      return entry;
    });
    expect(orderedEntries).toHaveLength(entries.length);
    const readdir = vi.spyOn(fs, "readdirSync");
    readdir
      .mockReturnValueOnce(orderedEntries)
      .mockReturnValueOnce(orderedEntries);
    const reads = vi.spyOn(fs, "readFileSync");
    let readPaths: unknown[];
    let sharedReads: unknown[];
    try {
      patchCloudflareModuleServerOutput(dir);
      readPaths = reads.mock.calls.map((args) => args[0]);
      sharedReads = reads.mock.calls.flatMap((args, index) =>
        args[0] === shared ? [reads.mock.results[index]?.value] : [],
      );
    } finally {
      reads.mockRestore();
      readdir.mockRestore();
    }
    const earlyRead = readPaths.indexOf(early);
    const lateRead = readPaths.indexOf(entry);
    expect(earlyRead).toBeGreaterThanOrEqual(0);
    expect(lateRead).toBeGreaterThan(earlyRead);
    expect(readPaths.slice(earlyRead + 1, lateRead)).toContain(shared);
    for (const name of moduleNames) {
      expect(readPaths.slice(earlyRead + 1, lateRead)).toContain(
        path.join(dir, name),
      );
    }
    expect(readPaths.slice(lateRead + 1)).toContain(shared);
    expect(sharedReads.length).toBeGreaterThanOrEqual(3);
    expect(sharedReads).toEqual(sharedReads.map(() => sharedSource));

    const worker = new Miniflare({
      modules: true,
      scriptPath: entry,
      modulesRoot: dir,
      compatibilityDate: "2026-04-01",
      compatibilityFlags: ["nodejs_compat"],
    });
    try {
      const response = await worker.dispatchFetch("http://localhost/");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        shared: true,
        early: true,
        consumer: true,
        buffer: "function",
      });
    } finally {
      await worker.dispose();
    }
  });
});
