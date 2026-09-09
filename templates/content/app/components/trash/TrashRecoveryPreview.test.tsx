import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  canRestore: false,
  canPermanentlyDelete: false,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatDate: () => "date" }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/editor/TrashDocumentPreview", () => ({
  TrashDocumentPreview: ({
    actions,
  }: {
    actions: (document: unknown) => unknown;
  }) =>
    actions({
      id: "page",
      kind: "database",
      title: "Page",
      database: { id: "db" },
      accessRole: "viewer",
      ...state,
    }),
}));
vi.mock("./TrashRecoveryActions", () => ({
  TrashRecoveryActions: ({ items }: { items: unknown[] }) => (
    <pre>{JSON.stringify(items)}</pre>
  ),
}));

import { TrashRecoveryPreview } from "./TrashRecoveryPreview";

describe("preview recovery controls", () => {
  it("exposes host-authorized restore for a backing-page viewer without enabling purge", () => {
    state.canRestore = true;
    state.canPermanentlyDelete = false;
    const html = renderToStaticMarkup(
      <TrashRecoveryPreview documentId="page" />,
    );
    expect(html).toContain("&quot;canRestore&quot;:true");
    expect(html).toContain("&quot;canPermanentlyDelete&quot;:false");
  });

  it("does not mount recovery controls when both operation flags are false", () => {
    state.canRestore = false;
    state.canPermanentlyDelete = false;
    expect(
      renderToStaticMarkup(<TrashRecoveryPreview documentId="page" />),
    ).not.toContain("<pre>");
  });
});
