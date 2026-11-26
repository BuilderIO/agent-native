import { describe, expect, it } from "vitest";

import { rewriteWorkspaceIconImports } from "./workspace-icon-imports.js";

describe("workspace icon imports", () => {
  const available = async (path: string) => path.endsWith("/IconAlpha.mjs");
  it("uses a leaf for named icons and preserves aliases and other exports", async () => {
    const result = await rewriteWorkspaceIconImports(
      'import { IconAlpha as Renamed, IconMissing, type IconProps } from "@tabler/icons-react";\nconst value = Renamed;',
      "entry.ts",
      available,
    );
    expect(result?.code).toContain(
      'import Renamed from "@tabler/icons-react/dist/esm/icons/IconAlpha.mjs";',
    );
    expect(result?.code).toContain(
      'import { IconMissing, type IconProps } from "@tabler/icons-react";',
    );
    expect(result?.code).toContain("const value = Renamed;");
    expect(result?.map.sources).toEqual(["entry.ts"]);
  });
  it("leaves full catalogs, type imports, side effects, defaults and unrelated modules intact", async () => {
    for (const source of [
      'import * as icons from "@tabler/icons-react"; Object.values(icons);',
      'import { IconAlpha } from "@tabler/icons-react"; @decorate class Decorated {}',
      'import type { IconAlpha } from "@tabler/icons-react";',
      'import "@tabler/icons-react";',
      'import IconAlpha from "@tabler/icons-react";',
      'import { IconAlpha } from "@tabler/icons-react" with { type: "custom" };',
      'import { IconAlpha } from "some-icons";',
      'const text = "import { IconAlpha } from @tabler/icons-react";',
    ])
      expect(
        await rewriteWorkspaceIconImports(source, "entry.ts", available),
      ).toBeNull();
  });
  it("keeps a mixed default import and rewrites only resolvable runtime icons", async () => {
    const result = await rewriteWorkspaceIconImports(
      'import Default, { IconAlpha, IconMissing } from "@tabler/icons-react/dist/esm/icons/index.mjs";',
      "entry.ts",
      available,
    );
    expect(result?.code).toContain(
      'import IconAlpha from "@tabler/icons-react/dist/esm/icons/IconAlpha.mjs";',
    );
    expect(result?.code).toContain(
      'import Default, { IconMissing } from "@tabler/icons-react/dist/esm/icons/index.mjs";',
    );
  });
});
