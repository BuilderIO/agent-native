import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

import { DeleteCollectionDialog } from "./DeleteCollectionDialog";

describe("DeleteCollectionDialog", () => {
  it("states that projects survive and that it cannot be undone", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <DeleteCollectionDialog
          collectionId="col_1"
          collectionName="QA revenue"
          onClose={() => {}}
          onDeleted={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain("Permanently delete collection");
    expect(html).toContain("QA revenue");
    expect(html).toContain("will not be deleted");
    expect(html).toContain("Delete collection");
    expect(html).toContain("Cancel");
  });
});
