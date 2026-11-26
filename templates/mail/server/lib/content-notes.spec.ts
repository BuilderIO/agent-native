import { resetAppConfigForTests } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  userEmail: "owner@example.com" as string | undefined,
}));
const invokeAgentAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  getBuiltinAgents: () => [
    { id: "content", url: "https://content.agent-native.com" },
  ],
}));

vi.mock("@agent-native/core/a2a", () => ({
  invokeAgentAction,
  resolveA2ACallerAuth: async () => ({ userEmail: auth.userEmail }),
}));

const note = {
  markdown: "- **2026-11-25** Met at the launch",
  truncated: false,
  url: "https://content.agent-native.com/_agent-native/open?app=content&view=editor&documentId=p1",
  updatedAt: "2026-11-25T15:00:00.000Z",
};

function reply(status: "completed" | "failed", output: unknown) {
  return {
    target: { url: "https://content.agent-native.com" },
    result: {
      status,
      output: typeof output === "string" ? output : JSON.stringify(output),
    },
  };
}

describe("Content notes", () => {
  beforeEach(() => {
    auth.userEmail = "owner@example.com";
    invokeAgentAction.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAppConfigForTests();
  });

  it("reads a person's note from Content's get-mail-note", async () => {
    invokeAgentAction.mockResolvedValue(reply("completed", { note }));
    const { readContactNote } = await import("./content-notes.js");

    await expect(readContactNote("ada@example.com")).resolves.toEqual({
      note,
    });
    expect(invokeAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "content",
        selfAppId: "mail",
        action: "get-mail-note",
        input: { email: "ada@example.com" },
        userEmail: "owner@example.com",
      }),
    );
  });

  it("keeps no note apart from a failed read", async () => {
    const { readContactNote } = await import("./content-notes.js");

    invokeAgentAction.mockResolvedValue(reply("completed", { note: null }));
    await expect(readContactNote("ada@example.com")).resolves.toEqual({
      note: null,
    });

    invokeAgentAction.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(readContactNote("ada@example.com")).rejects.toMatchObject({
      errorCode: "content_unavailable",
      statusCode: 502,
    });

    invokeAgentAction.mockResolvedValue(
      reply("completed", { note: { markdown: 1 } }),
    );
    await expect(readContactNote("ada@example.com")).rejects.toMatchObject({
      errorCode: "content_invalid_response",
    });
  });

  it("passes on Content's reason when a note page is in Trash or locked", async () => {
    const { addContactNote, readContactNote } =
      await import("./content-notes.js");

    invokeAgentAction.mockResolvedValue(
      reply("failed", "Error: in Trash (errorCode: mail_note_trashed)"),
    );
    await expect(readContactNote("ada@example.com")).rejects.toMatchObject({
      errorCode: "mail_note_trashed",
      statusCode: 409,
    });

    invokeAgentAction.mockResolvedValue(
      reply("failed", "Error: locked (errorCode: AGENT_TEXT_LOCKED)"),
    );
    await expect(
      addContactNote({ email: "ada@example.com", text: "Hi" }),
    ).rejects.toMatchObject({
      errorCode: "AGENT_TEXT_LOCKED",
      statusCode: 403,
    });

    invokeAgentAction.mockResolvedValue(
      reply("failed", "Error: rekeyed (errorCode: mail_notes_key_changed)"),
    );
    await expect(readContactNote("ada@example.com")).rejects.toMatchObject({
      errorCode: "mail_notes_key_changed",
      statusCode: 409,
    });

    invokeAgentAction.mockResolvedValue(reply("failed", "Error: boom"));
    await expect(
      addContactNote({ email: "ada@example.com", text: "Hi" }),
    ).rejects.toMatchObject({ errorCode: "content_note_unavailable" });
  });

  it("links the new line back to the email it was written beside", async () => {
    vi.stubEnv("APP_URL", "https://mail.agent-native.com");
    resetAppConfigForTests();
    invokeAgentAction.mockResolvedValue(
      reply("completed", { note, created: true, appended: true }),
    );
    const { addContactNote } = await import("./content-notes.js");

    await expect(
      addContactNote({
        email: "ada@example.com",
        text: "Met at the launch",
        name: " Ada Lovelace ",
        date: "2026-11-25",
        threadId: "thread-1",
        subject: "Launch recap",
      }),
    ).resolves.toEqual({ note, created: true, appended: true });

    const call = invokeAgentAction.mock.calls[0]?.[0] as {
      action: string;
      input: Record<string, unknown>;
    };
    expect(call.action).toBe("add-mail-note");
    expect(call.input).toMatchObject({
      email: "ada@example.com",
      text: "Met at the launch",
      name: "Ada Lovelace",
      date: "2026-11-25",
      link: { label: "Launch recap" },
    });
    const link = call.input.link as { url: string };
    const url = new URL(link.url);
    expect(url.origin).toBe("https://mail.agent-native.com");
    expect(url.searchParams.get("threadId")).toBe("thread-1");
  });

  it("refuses before calling Content when nobody is signed in", async () => {
    auth.userEmail = undefined;
    const { readContactNote } = await import("./content-notes.js");

    await expect(readContactNote("ada@example.com")).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(invokeAgentAction).not.toHaveBeenCalled();
  });
});
