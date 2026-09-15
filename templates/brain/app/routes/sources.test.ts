import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readRouteSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("sources route pointer-lock guards", () => {
  it("reuses the shared pointer-unlock helper instead of a local copy", () => {
    const source = readRouteSource("./sources.tsx");

    expect(source).toContain(
      'import { afterBodyPointerUnlock } from "@/components/ui/pointer-lock"',
    );
    expect(source).not.toContain("function afterBodyPointerUnlock");
  });

  it("defers opening the tune-source Sheet until the row menu's layer unlocks", () => {
    const source = readRouteSource("./sources.tsx");

    // "Tune source" is a DropdownMenuItem; selecting it opens the setupOpen
    // Sheet (three nested Selects) in the same tick the menu's own
    // dismissable layer is still unregistering. Mounting a new
    // disableOutsidePointerEvents layer before that unregister flushes is
    // the exact race that leaves document.body.style.pointerEvents stuck at
    // "none" forever (see packages/toolkit/src/ui/pointer-lock.ts).
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

    // setupOpen has three nested Selects; closing it while immediately
    // mounting the handoff Dialog is the same close-then-open race as the
    // tune-source case above.
    expect(submitSourceBlock).toContain(
      "afterBodyPointerUnlock(() => setIngestHandoff(handoff));",
    );
  });
});
