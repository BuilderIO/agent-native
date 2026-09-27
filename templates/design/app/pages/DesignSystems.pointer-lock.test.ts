import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./DesignSystems.tsx", import.meta.url),
  "utf8",
);

describe("design systems delete flow pointer-lock guard", () => {
  it("reuses the shared pointer-unlock helper instead of a local copy", () => {
    expect(source).toContain(
      'import { afterBodyPointerUnlock } from "@/components/ui/pointer-lock"',
    );
    expect(source).not.toContain("function afterBodyPointerUnlock");
  });

  it("defers opening the delete AlertDialog until the row menu's layer unlocks", () => {
    const deleteItemBlock = source
      .slice(
        source.indexOf("<DropdownMenuItem"),
        source.indexOf("</DropdownMenuItem>"),
      )
      .replace(/\s+/g, " ");

    expect(deleteItemBlock).toContain(
      "afterBodyPointerUnlock(() => setDeleteId(ds.id),",
    );
  });
});
