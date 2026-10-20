import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRequestURL = vi.hoisted(() => vi.fn());
const mockSetResponseHeader = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestURL: (...args: unknown[]) => mockGetRequestURL(...args),
  setResponseHeader: (...args: unknown[]) => mockSetResponseHeader(...args),
}));

import handler from "./[...page].head";

function makeEvent(pathname: string) {
  const event = { pathname };
  mockGetRequestURL.mockReturnValue(
    new URL(`https://clips.example.test${pathname}`),
  );
  return event;
}

describe("Clips page HEAD route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the root redirect as HTML so the SSR cache policy can apply", () => {
    const response = handler(makeEvent("/") as never);

    expect(response).toMatchObject({ status: 302 });
    expect(response.headers.get("location")).toBe("/library");
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("keeps non-root HEAD responses as HTML", () => {
    const response = handler(makeEvent("/library") as never);

    expect(response).toMatchObject({ status: 200 });
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.get("location")).toBeNull();
  });
});
