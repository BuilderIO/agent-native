import type {
  AgentConnectionRequest,
  AgentMessage,
} from "@agent-native/agentkit/protocol";
import { describe, expect, it } from "vitest";

import {
  latestReplyContext,
  pickReplyConnectionSuggestion,
  type LatestReplyContext,
} from "./reply-connection-suggestion.js";

function message(id: string, role: "user" | "assistant", text: string) {
  return {
    id,
    role,
    status: "complete",
    parts: [{ type: "text", text }],
  } as unknown as AgentMessage;
}

const slack = { id: "slack", provider: "slack", name: "Slack" };
const notion = { id: "notion", provider: "notion", name: "Notion" };
const find = (text: string) =>
  /Slack/.test(text) ? slack : /Notion/.test(text) ? notion : null;

const latest: LatestReplyContext = {
  isLatest: true,
  userText: "Connect Slack",
  agentRequestedProviders: "",
};

describe("latestReplyContext", () => {
  const messages = [
    message("u1", "user", "Connect Slack"),
    message("a1", "assistant", "Working on it."),
    message("u2", "user", "Connect Notion"),
    message("a2", "assistant", "Still working."),
    message("a3", "assistant", "Done."),
  ];

  it("offers a connection only on the thread's newest message", () => {
    const thread = { messages, connectionRequests: {} };
    expect(latestReplyContext(thread, "a1").isLatest).toBe(false);
    expect(latestReplyContext(thread, "a2").isLatest).toBe(false);
    expect(latestReplyContext(thread, "a3")).toMatchObject({
      isLatest: true,
      userText: "Connect Notion",
    });
  });

  it("lists every provider the agent asked for, settled or not", () => {
    const request = (
      provider: string,
      status: AgentConnectionRequest["status"],
    ) => ({ id: provider, provider, reason: "missing", status }) as const;
    const context = latestReplyContext(
      {
        messages,
        connectionRequests: {
          one: request("Slack", "requested"),
          two: request("notion", "connected"),
          three: request("linear", "declined"),
        } as Record<string, AgentConnectionRequest>,
      },
      "a3",
    );
    expect(context.agentRequestedProviders).toBe("linear\nnotion\nslack");
  });
});

describe("pickReplyConnectionSuggestion", () => {
  const pick = (
    context: LatestReplyContext,
    replyText: string,
    replyFinished: boolean,
  ) =>
    pickReplyConnectionSuggestion({ context, replyText, replyFinished, find });

  it("offers nothing until the reply finishes", () => {
    expect(pick(latest, "Connect Notion there.", false)).toBeNull();
    expect(pick(latest, "", true)).toBe(slack);
  });

  it("never offers anything on an older reply", () => {
    expect(
      pick({ ...latest, isLatest: false }, "Connect Notion.", true),
    ).toBeNull();
  });

  it("prefers the finished reply's ask over the sent request", () => {
    expect(pick(latest, "Connect Notion to file it.", true)).toBe(notion);
    expect(pick(latest, "Posted it.", true)).toBe(slack);
  });

  it("matches the agent's request by brand name, not only catalog id", () => {
    const jira = { id: "atlassian", provider: "atlassian", name: "Jira" };
    expect(
      pickReplyConnectionSuggestion({
        context: {
          ...latest,
          userText: "Connect Jira",
          agentRequestedProviders: "jira",
        },
        replyText: "",
        replyFinished: true,
        find: () => jira,
      }),
    ).toBeNull();
  });

  it("never duplicates the agent's own connection request card", () => {
    expect(
      pick(
        { ...latest, agentRequestedProviders: "slack" },
        "Connect Slack.",
        true,
      ),
    ).toBeNull();
  });
});
