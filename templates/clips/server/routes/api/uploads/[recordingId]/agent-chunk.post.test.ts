import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRouterParam: vi.fn(),
  handleRecordingChunk: vi.fn(),
  requireRecordingUploadTicketOwner: vi.fn(),
}));

vi.mock("h3", () => ({
  createError: ({ statusCode, message }: any) =>
    Object.assign(new Error(message), { statusCode }),
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: mocks.getRouterParam,
}));

vi.mock("../../../../lib/recording-upload-ticket.js", () => ({
  requireRecordingUploadTicketOwner: mocks.requireRecordingUploadTicketOwner,
}));

vi.mock("./chunk.post.js", () => ({
  handleRecordingChunk: mocks.handleRecordingChunk,
}));

import handler from "./agent-chunk.post";

const event = { path: "/api/uploads/rec-1/agent-chunk" } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRouterParam.mockReturnValue("rec-1");
  mocks.handleRecordingChunk.mockResolvedValue({
    ok: true,
    finalized: false,
    index: 0,
    bytes: 3,
  });
});

describe("/api/uploads/:recordingId/agent-chunk route", () => {
  it("runs the chunk upload as the ticket's owner for its recording", async () => {
    const owner = {
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };
    mocks.requireRecordingUploadTicketOwner.mockResolvedValue(owner);

    await expect((handler as any)(event)).resolves.toEqual({
      ok: true,
      finalized: false,
      index: 0,
      bytes: 3,
    });
    expect(mocks.requireRecordingUploadTicketOwner).toHaveBeenCalledWith(
      event,
      "rec-1",
    );
    expect(mocks.handleRecordingChunk).toHaveBeenCalledWith(event, owner);
  });

  it("does not reach the chunk handler when the ticket is refused", async () => {
    mocks.requireRecordingUploadTicketOwner.mockRejectedValue(
      Object.assign(new Error("Invalid or expired upload ticket"), {
        statusCode: 401,
      }),
    );

    await expect((handler as any)(event)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mocks.handleRecordingChunk).not.toHaveBeenCalled();
  });

  it("rejects a request without a recording id", async () => {
    mocks.getRouterParam.mockReturnValue(undefined);

    await expect((handler as any)(event)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mocks.requireRecordingUploadTicketOwner).not.toHaveBeenCalled();
    expect(mocks.handleRecordingChunk).not.toHaveBeenCalled();
  });
});
