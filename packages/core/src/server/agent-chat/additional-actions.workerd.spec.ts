import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { expect, it } from "vitest";

it("starts and validates schema-less actions in workerd without code generation", async () => {
  const requireFromWrangler = createRequire(
    createRequire(import.meta.url).resolve("wrangler/package.json"),
  );
  const { Miniflare } = requireFromWrangler("miniflare") as {
    Miniflare: new (options: {
      modules: boolean;
      script: string;
      compatibilityDate: string;
      compatibilityFlags: string[];
    }) => {
      dispatchFetch(url: string): Promise<Response>;
      dispose(): Promise<void>;
    };
  };
  const bundle = await build({
    stdin: {
      contents: `
        import { resolveAppAdditionalActions } from "./additional-actions.js";
        import { runWithRequestContext } from "../request-context.js";
        export default { async fetch() {
          const principal = { userEmail: "alice@example.com", orgId: "acme" };
          const added = await resolveAppAdditionalActions({
            resolver: () => ({ example: { tool: { description: "Example" }, run: async (args) => args } }),
            externalSurfaces: [],
            isReservedName: () => false,
          }, { surface: "chat", ownerEmail: principal.userEmail, orgId: principal.orgId }, {});
          const run = (input) => runWithRequestContext(principal, () => added.example.run(input));
          let codeGenerationBlocked = false;
          try { new Function("return 1")(); }
          catch { codeGenerationBlocked = true; }
          const valid = await run({ value: 1 });
          const missing = await run(undefined);
          const invalid = [];
          for (const input of [null, false, 0, "{}", []]) {
            try { await run(input); invalid.push("accepted"); }
            catch (error) { invalid.push(error.message); }
          }
          return Response.json({ codeGenerationBlocked, valid, missing, invalid });
        } };
      `,
      resolveDir: path.dirname(fileURLToPath(import.meta.url)),
      sourcefile: "worker.ts",
      loader: "ts",
    },
    plugins: [
      {
        name: "workerd-unsupported-playwright",
        setup(build) {
          build.onResolve(
            { filter: /^playwright(?:-core)?(?:\/.*)?$/ },
            () => ({ path: "playwright", namespace: "unsupported" }),
          );
          build.onLoad({ filter: /.*/, namespace: "unsupported" }, () => ({
            contents: "module.exports = {}",
            loader: "js",
          }));
        },
      },
    ],
    // workerd permits new Function during module evaluation by default, even
    // though it rejects it during requests. Enforce the request policy at boot.
    banner: {
      js: `globalThis.Function = new Proxy(Function, {
        apply() { throw new EvalError("Code generation from strings disallowed for this context"); },
        construct() { throw new EvalError("Code generation from strings disallowed for this context"); },
      });`,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "es2022",
  });
  const worker = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-04-01",
    compatibilityFlags: ["nodejs_compat"],
  });
  try {
    const response = await worker.dispatchFetch("http://localhost/");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      codeGenerationBlocked: true,
      valid: { value: 1 },
      missing: {},
      invalid: Array(5).fill(
        "Invalid arguments for example: input must be object",
      ),
    });
  } finally {
    await worker.dispose();
  }
});
