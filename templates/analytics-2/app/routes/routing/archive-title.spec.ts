import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { VIEW_TITLE_KEYS } from "@/components/workspace/view-titles";
import messages from "@/i18n/en-US";

const lookup = (key: string) =>
  key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      messages,
    );

describe("list view tab titles", () => {
  it("names the Archive list tab after its page, not its sidebar link", () => {
    expect(lookup(VIEW_TITLE_KEYS.archive as string)).toBe("Archived");
  });

  it("keeps the other list tabs on their sidebar names", () => {
    expect(lookup(VIEW_TITLE_KEYS.trash as string)).toBe("Trash");
    expect(lookup(VIEW_TITLE_KEYS.all as string)).toBe("Projects");
    expect(lookup(VIEW_TITLE_KEYS.you as string)).toBe("Projects");
    expect(lookup(VIEW_TITLE_KEYS.sharedWithYou as string)).toBe("Projects");
    expect(lookup(VIEW_TITLE_KEYS.sharedWithOrg as string)).toBe("Projects");
    expect(lookup(VIEW_TITLE_KEYS.threads as string)).toBe("Threads");
  });

  it("uses the shared VIEW_TITLE_KEYS map in WorkspaceApplication without shadowing", () => {
    const appSource = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../components/workspace/WorkspaceApplication.tsx",
      ),
      "utf8",
    );
    expect(appSource).toMatch(/from\s+["']\.\/view-titles["']/);
    expect(appSource).not.toMatch(/const\s+VIEW_TITLE_KEYS\b/);
  });
});
