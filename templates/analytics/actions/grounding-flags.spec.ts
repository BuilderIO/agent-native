import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import prometheus from "./prometheus";

const actionsDir = new URL(".", import.meta.url);

function declaresGrounding(name: string): boolean {
  const source = readFileSync(new URL(`${name}.ts`, actionsDir), "utf8");
  return /^\s{2}grounding: true,$/m.test(source);
}

describe("grounding declarations", () => {
  it("declares Prometheus as a grounding source action", () => {
    expect(declaresGrounding("prometheus")).toBe(true);
    expect(prometheus.grounding).toBe(true);
  });

  // Every provider action reaches its source through requireActionCredentials.
  // The response guard used to consult a separate name list, so a provider
  // action could ship fully working and still have its grounded answer replaced
  // with "connect data sources". Keeping the two in step is now one flag.
  it("declares every credentialed provider action as grounding", () => {
    const missing = readdirSync(actionsDir)
      .filter(
        (file) =>
          file.endsWith(".ts") &&
          !file.endsWith(".spec.ts") &&
          !file.startsWith("_"),
      )
      .map((file) => file.replace(/\.ts$/, ""))
      .filter(
        (name) =>
          readFileSync(new URL(`${name}.ts`, actionsDir), "utf8").includes(
            "requireActionCredentials(",
          ) && !declaresGrounding(name),
      );

    expect(missing).toEqual([]);
  });
});
