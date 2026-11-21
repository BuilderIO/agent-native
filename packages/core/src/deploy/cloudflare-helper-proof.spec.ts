import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { patchCloudflareModuleServerOutput } from "./build.js";

it("handles native factories passed to local helper parameters in workerd", async () => {
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
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
    ".tmp",
  );
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "worker-helper-proof-"));
  const entry = path.join(dir, "worker.mjs");
  try {
    fs.writeFileSync(
      entry,
      `
      import {createRequire as native} from "node:module";
      import process from "node:process";
      const alias = native;
      const events = [];
      function helper(label, factory) {
        const local = factory;
        return local((events.push(label), import.meta.url))("process");
      }
      const arrow = (factory) => factory(import.meta.url)("node:process");
      function relay(factory) { return helper("relay", factory); }
      function recursive(factory, recurse) {
        return recurse ? recursive(factory, false) : factory(import.meta.url)("process");
      }
      const custom = function(base) {
        events.push(this === undefined ? "unbound" : "bound");
        return (name) => "custom:" + name + ":" + (typeof base);
      };
      function shadow() {
        function helper(label, factory) { return factory(label)("process"); }
        return helper("shadow", (base) => (name) => base + ":" + name);
      }
      const direct = helper("direct", native) === process;
      const aliased = helper("alias", alias) === process;
      const forwarded = relay(native) === process;
      const arrowResult = arrow(native) === process;
      const recursiveResult = recursive(native, true) === process;
      const customResult = helper("custom", custom);
      const apply = Reflect.apply;
      let shadowWraps = 0;
      Reflect.apply = (...args) => { shadowWraps++; return apply(...args); };
      const shadowResult = shadow();
      Reflect.apply = apply;
      export default {fetch() {return Response.json({direct, aliased, forwarded, arrowResult, recursiveResult, customResult, shadowResult, shadowWraps, events});}};
    `,
    );
    patchCloudflareModuleServerOutput(dir);
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
        direct: true,
        aliased: true,
        forwarded: true,
        arrowResult: true,
        recursiveResult: true,
        customResult: "custom:process:string",
        shadowResult: "shadow:process",
        shadowWraps: 0,
        events: ["direct", "alias", "relay", "custom", "unbound"],
      });
    } finally {
      await worker.dispose();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
