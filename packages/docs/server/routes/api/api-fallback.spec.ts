import { describe, expect, it, vi } from "vitest";

const mockSetResponseHeaders = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  setResponseHeaders: mockSetResponseHeaders,
  setResponseStatus: mockSetResponseStatus,
}));

import handler from "./[...path].get";

describe("unknown public API routes", () => {
  it("returns a structured JSON recovery response", () => {
    const event = {} as never;

    expect(handler(event)).toEqual({
      error: {
        code: "api_route_not_found",
        message: "API route not found.",
        resolution:
          "Review the published OpenAPI specification at /openapi.json.",
      },
    });
    expect(mockSetResponseStatus).toHaveBeenCalledWith(
      event,
      404,
      "API route not found.",
    );
    expect(mockSetResponseHeaders).toHaveBeenCalledWith(event, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
  });
});
