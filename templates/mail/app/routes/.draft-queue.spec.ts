import type { LoaderFunctionArgs } from "react-router";
import { describe, expect, it } from "vitest";

import { loader } from "./draft-queue";

function runLoader(search: string, id?: string) {
  return loader({
    params: id ? { id } : {},
    request: new Request(
      `http://localhost/draft-queue${id ? `/${id}` : ""}${search}`,
    ),
    context: {},
  } as LoaderFunctionArgs);
}

describe("draft-queue loader", () => {
  it("sends the bare Draft queue to Drafts, which lists requested drafts", () => {
    const result = runLoader("");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("Location")).toBe("/drafts");
  });

  it("keeps a request's own link and Requested by me on the review page", () => {
    expect(runLoader("", "qd_1")).toBeNull();
    expect(runLoader("?id=qd_1")).toBeNull();
    expect(runLoader("?scope=requested")).toBeNull();
  });
});
