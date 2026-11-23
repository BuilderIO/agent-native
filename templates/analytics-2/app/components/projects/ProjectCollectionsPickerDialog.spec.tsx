import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async () => {
  const messages = (await import("../../i18n/en-US")).default as Record<
    string,
    unknown
  >;
  const lookup = (key: string): string => {
    let node: unknown = messages;
    for (const part of key.split(".")) {
      node = (node as Record<string, unknown> | undefined)?.[part];
    }
    return typeof node === "string" ? node : key;
  };
  return {
    useT: () => (key: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, value),
        lookup(key),
      ),
  };
});

import { ProjectCollectionsPickerDialog } from "./ProjectCollectionsPickerDialog";

describe("ProjectCollectionsPickerDialog", () => {
  it("checks the collections the project is already filed into", () => {
    const html = renderToStaticMarkup(
      <ProjectCollectionsPickerDialog
        projectTitle="Revenue"
        collections={[
          { id: "col_a", name: "QA revenue" },
          { id: "col_b", name: "QA ops" },
        ]}
        filedIds={["col_b"]}
        onClose={() => {}}
        onToggle={async () => {}}
      />,
    );
    expect(html).toContain("Add to collection");
    expect(html).toContain("QA revenue");
    expect(html).toContain("QA ops");
    // Exactly one box is checked: the collection already filed.
    expect(html.match(/checked=""/g) ?? []).toHaveLength(1);
  });

  it("explains an empty collection catalogue", () => {
    const html = renderToStaticMarkup(
      <ProjectCollectionsPickerDialog
        projectTitle="Revenue"
        collections={[]}
        filedIds={[]}
        onClose={() => {}}
        onToggle={async () => {}}
      />,
    );
    expect(html).toContain("This workspace has no collections yet.");
  });
});
