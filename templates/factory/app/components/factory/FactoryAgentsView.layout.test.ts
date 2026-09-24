import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readViewSource() {
  return readFileSync(
    new URL("./FactoryAgentsView.tsx", import.meta.url),
    "utf8",
  );
}

describe("FactoryAgentsView app creation freshness", () => {
  it("passes the app-list refetch to both create-app entry points", () => {
    const source = readViewSource();

    expect(
      source.match(/onCreated=\{\(\) => void query\.refetch\(\)\}/g),
    ).toHaveLength(2);
  });
});
