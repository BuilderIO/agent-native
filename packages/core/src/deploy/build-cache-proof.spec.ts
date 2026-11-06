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
  it.each(["a", "z"])(
    "rewrites calls through a long cyclic export chain when the consumer sorts %s",
    async (consumerPrefix) => {
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
      for (let i = 0; i < 16; i++) {
        fs.writeFileSync(
          path.join(dir, `relay-${i}.mjs`),
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
      const entry = path.join(dir, `${consumerPrefix}-worker.mjs`);
      fs.writeFileSync(
        entry,
        `import {factory, check} from "./shared.mjs";
         import process from "node:process";
         export default {fetch() {return Response.json({
           shared: check(),
           consumer: [${Array.from({ length: 100 }, () => 'factory(import.meta.url)("node:process") === process').join(",")}].every(Boolean),
           buffer: typeof factory(import.meta.url)("node:buffer").Buffer,
         });}};`,
      );
      const reads = vi.spyOn(fs, "readFileSync");
      let sharedReads: unknown[];
      try {
        patchCloudflareModuleServerOutput(dir);
        sharedReads = reads.mock.calls.flatMap((args, index) =>
          args[0] === shared ? [reads.mock.results[index]?.value] : [],
        );
      } finally {
        reads.mockRestore();
      }
      expect(sharedReads.length).toBeGreaterThanOrEqual(2);
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
          consumer: true,
          buffer: "function",
        });
      } finally {
        await worker.dispose();
      }
    },
  );
});
