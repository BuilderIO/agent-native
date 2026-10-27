import { describe, expect, it } from "vitest";

import { rangeWasIgnored, readRangeResponse } from "./mse-video-loader";

describe("rangeWasIgnored", () => {
  it("flags a whole-file 200 answering a nonzero range request", () => {
    expect(rangeWasIgnored(200, 5_000_000)).toBe(true);
  });

  it("accepts a 200 for a request that started at byte 0", () => {
    expect(rangeWasIgnored(200, 0)).toBe(false);
  });

  it("accepts a normal partial response", () => {
    expect(rangeWasIgnored(206, 5_000_000)).toBe(false);
  });
});

describe("readRangeResponse", () => {
  const total = 280_524_667;
  const MB = 1024 * 1024;

  it("reads a full window mid-file as not EOF", () => {
    expect(
      readRangeResponse({
        status: 206,
        requestedStart: 2 * MB,
        contentRange: `bytes ${2 * MB}-${4 * MB - 1}/${total}`,
        bodyLength: 2 * MB,
      }),
    ).toEqual({ total, eof: false });
  });

  it("keeps streaming when the server answers with a smaller range", () => {
    expect(
      readRangeResponse({
        status: 206,
        requestedStart: 0,
        contentRange: `bytes 0-${MB - 1}/${total}`,
        bodyLength: MB,
      }),
    ).toEqual({ total, eof: false });
  });

  it("throws on a body shorter than its Content-Range instead of reporting EOF", () => {
    expect(() =>
      readRangeResponse({
        status: 206,
        requestedStart: 0,
        contentRange: `bytes 0-${2 * MB - 1}/${total}`,
        bodyLength: MB,
      }),
    ).toThrow(/truncated/);
  });

  it("reports EOF only when the bytes reach the declared total", () => {
    expect(
      readRangeResponse({
        status: 206,
        requestedStart: total - 100,
        contentRange: `bytes ${total - 100}-${total - 1}/${total}`,
        bodyLength: 100,
      }),
    ).toEqual({ total, eof: true });
  });

  it("does not infer EOF from a short body when the total is unknown", () => {
    expect(
      readRangeResponse({
        status: 206,
        requestedStart: 0,
        contentRange: `bytes 0-${MB - 1}/*`,
        bodyLength: MB,
      }),
    ).toEqual({ total: null, eof: false });
  });

  it("throws when the Content-Range ends past the declared total", () => {
    expect(() =>
      readRangeResponse({
        status: 206,
        requestedStart: 0,
        contentRange: `bytes 0-${MB - 1}/${MB / 2}`,
        bodyLength: MB,
      }),
    ).toThrow(/invalid Content-Range/);
  });

  it("throws when the Content-Range end is before its start", () => {
    expect(() =>
      readRangeResponse({
        status: 206,
        requestedStart: MB,
        contentRange: `bytes ${MB}-0/${total}`,
        bodyLength: 0,
      }),
    ).toThrow(/invalid Content-Range/);
  });

  it("throws when a 206 has no readable Content-Range", () => {
    expect(() =>
      readRangeResponse({
        status: 206,
        requestedStart: 0,
        contentRange: null,
        bodyLength: MB,
      }),
    ).toThrow(/Content-Range/);
  });

  it("throws when the response starts at a different byte", () => {
    expect(() =>
      readRangeResponse({
        status: 206,
        requestedStart: MB,
        contentRange: `bytes 0-${MB - 1}/${total}`,
        bodyLength: MB,
      }),
    ).toThrow(/starts at byte 0/);
  });

  it("treats a whole-file 200 as EOF", () => {
    expect(
      readRangeResponse({
        status: 200,
        requestedStart: 0,
        contentRange: null,
        bodyLength: 5000,
      }),
    ).toEqual({ total: 5000, eof: true });
  });
});
