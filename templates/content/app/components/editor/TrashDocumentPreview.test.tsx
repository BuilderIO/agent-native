import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => query.result,
}));

import {
  TrashDocumentPreview,
  type TrashPreviewLabels,
} from "./TrashDocumentPreview";

const labels: TrashPreviewLabels = {
  readOnly: "Read-only preview",
  unavailable: "Unavailable",
  properties: "Properties",
  comments: "Comments",
  history: "History",
  moreComments: "More comments",
  moreHistory: "More versions",
  computedUnavailable: "Unavailable",
  previous: "Previous",
  next: "Next",
  unsupported: "Source preview",
  retry: "Retry",
};
const document = {
  id: "page",
  title: "Private title",
  content: "Private body",
  description: "",
  properties: [],
  comments: [],
  versions: [],
};

beforeEach(() => {
  query.result = { data: document, isFetching: false };
});

describe("Trash read-only preview", () => {
  it("does not display stale cached data after access denial", () => {
    query.result.error = new Error("Denied");
    const html = renderToStaticMarkup(
      <TrashDocumentPreview documentId="page" labels={labels} />,
    );
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Private");
  });

  it("hides cached data while fresh authorization is pending", () => {
    query.result.isFetching = true;
    const html = renderToStaticMarkup(
      <TrashDocumentPreview documentId="page" labels={labels} />,
    );
    expect(html).not.toContain("Private");
    expect(html).toContain('aria-busy="true"');
  });
});
