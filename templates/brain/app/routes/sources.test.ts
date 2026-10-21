import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readRouteSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("sources route pointer-lock guards", () => {
  it("defers opening the tune-source Sheet until the row menu's layer unlocks", () => {
    const source = readRouteSource("./sources.tsx");

    expect(source).toContain(
      "onTune={() => afterBodyPointerUnlock(() => openEdit(source))}",
    );
  });

  it("defers opening a new source Sheet right after the advanced Sheet closes", () => {
    const source = readRouteSource("./sources.tsx");
    const onAddSourceBlock = source.slice(
      source.indexOf("onAddSource={(provider) => {"),
      source.indexOf("}}", source.indexOf("onAddSource={(provider) => {")) + 2,
    );

    expect(onAddSourceBlock).toContain("setAdvancedOpen(false);");
    expect(onAddSourceBlock).toContain(
      "afterBodyPointerUnlock(() => openCreate(provider));",
    );
  });

  it("defers opening the ingest handoff Dialog until the setup Sheet unlocks", () => {
    const source = readRouteSource("./sources.tsx");
    const submitSourceBlock = source.slice(
      source.indexOf("async function submitSource()"),
      source.indexOf("async function confirmArchiveSource()"),
    );

    expect(submitSourceBlock).toContain(
      "afterBodyPointerUnlock(() => setIngestHandoff(handoff));",
    );
  });
});
