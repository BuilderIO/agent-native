import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const routeParams = vi.hoisted(() => ({
  threadId: undefined as string | undefined,
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useParams: () => routeParams,
}));

import AskPage from "@/pages/Ask";

import AskRoute from "../routes/ask";
import AskThreadRoute from "../routes/ask.$threadId";

// Both paths must render the same component so the chat is not remounted when
// the thread URL changes mid-run.
describe("/ask/:threadId route shape", () => {
  it("serves the thread path from the same component as /ask", () => {
    expect(AskThreadRoute).toBe(AskRoute);
  });

  it("passes the URL thread id to the page, and null on the blank /ask", () => {
    routeParams.threadId = "thread-1";
    const thread = AskRoute() as ReactElement<{ threadId: string | null }>;
    expect(thread.type).toBe(AskPage);
    expect(thread.props.threadId).toBe("thread-1");

    routeParams.threadId = undefined;
    const blank = AskRoute() as ReactElement<{ threadId: string | null }>;
    expect(blank.props.threadId).toBeNull();
  });
});
