import { spawnSync } from "node:child_process";

import { build } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineConfig } from "./client.js";

describe("lazy Toolkit locale build opt-in", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [undefined, "false"],
    ["0", "false"],
    ["1", "true"],
  ])(
    "defines the root mode consumed by SSR and client (%s)",
    async (value, expected) => {
      vi.stubEnv("AGENT_NATIVE_LAZY_TOOLKIT_LOCALES", value);
      const config = defineConfig();
      expect(config.define?.__AGENT_NATIVE_LAZY_TOOLKIT_LOCALES__).toBe(
        expected,
      );
      expect(
        config.environments?.ssr?.define?.__AGENT_NATIVE_LAZY_TOOLKIT_LOCALES__,
      ).toBeUndefined();
      expect(
        config.environments?.client?.define
          ?.__AGENT_NATIVE_LAZY_TOOLKIT_LOCALES__,
      ).toBeUndefined();
      for (const environment of ["client", "ssr"]) {
        const virtualEntry = "virtual:locale-flag";
        const result = (await build({
          configFile: false,
          envDir: false,
          logLevel: "silent",
          define: config.define,
          plugins: [
            {
              name: "fixture-locale-flag",
              resolveId: (id) => (id === virtualEntry ? `\0${id}` : null),
              load: (id) =>
                id === `\0${virtualEntry}`
                  ? "export const enabled = __AGENT_NATIVE_LAZY_TOOLKIT_LOCALES__;"
                  : null,
            },
          ],
          build: {
            ssr: environment === "ssr",
            write: false,
            emptyOutDir: false,
            modulePreload: false,
            rolldownOptions: {
              input: virtualEntry,
              preserveEntrySignatures: "strict",
              output: { format: "es" },
            },
          },
        })) as { output: Array<{ type: string; code?: string }> };
        const code = result.output.find((item) => item.type === "chunk")!.code!;
        const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
        const run = spawnSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `console.log(JSON.stringify((await import(${JSON.stringify(url)})).enabled))`,
          ],
          { encoding: "utf8" },
        );
        expect(run.status, run.stderr).toBe(0);
        expect(run.stdout.trim(), environment).toBe(expected);
      }
    },
  );
});
