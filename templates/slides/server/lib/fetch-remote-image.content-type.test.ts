import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

const upstream = vi.hoisted(() => ({ contentType: "image/png" }));

vi.mock("node:https", () => {
  const request = (
    _target: URL,
    _options: unknown,
    onResponse: (response: EventEmitter) => void,
  ) => {
    const req = Object.assign(new EventEmitter(), {
      setTimeout: () => req,
      end: () => {
        const body = Buffer.from("image-bytes");
        const res = Object.assign(new EventEmitter(), {
          statusCode: 200,
          headers: {
            "content-type": upstream.contentType,
            "content-length": String(body.length),
          },
          destroy: () => undefined,
        });
        onResponse(res);
        setImmediate(() => {
          res.emit("data", body);
          res.emit("end");
        });
      },
    });
    return req;
  };
  return { default: { request }, request };
});

const { fetchRemoteImage } = await import("./fetch-remote-image.js");

describe("fetchRemoteImage upstream content types", () => {
  beforeEach(() => {
    upstream.contentType = "image/png";
  });

  it.each(["image/svg+xml", "image/svg+xml; charset=utf-8", "text/html"])(
    "refuses %s",
    async (contentType) => {
      upstream.contentType = contentType;
      const result = await fetchRemoteImage("https://cdn.example.com/a");
      expect(result).toEqual({ ok: false, reason: "not-an-image" });
    },
  );

  it("refuses a type that only starts with an accepted one", async () => {
    upstream.contentType = "image/pngx";
    const result = await fetchRemoteImage("https://cdn.example.com/a");
    expect(result).toEqual({ ok: false, reason: "not-an-image" });
  });

  it.each([
    ["image/png", "image/png"],
    ["IMAGE/JPEG; charset=binary", "image/jpeg"],
    ["image/gif", "image/gif"],
    ["image/webp", "image/webp"],
    ["image/avif", "image/avif"],
  ])("accepts %s as %s", async (contentType, expected) => {
    upstream.contentType = contentType;
    const result = await fetchRemoteImage("https://cdn.example.com/a");
    expect(result).toMatchObject({ ok: true, contentType: expected });
  });
});
