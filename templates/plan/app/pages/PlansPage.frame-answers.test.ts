import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendToAgentChat, toast } = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { success: vi.fn() });
  return { sendToAgentChat: vi.fn(), toast };
});

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendToAgentChat,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
}));

import { offerFrameQuestionAnswers } from "./PlansPage";

const t = ((key: string) => key) as Parameters<
  typeof offerFrameQuestionAnswers
>[0]["t"];

beforeEach(() => {
  sendToAgentChat.mockClear();
  toast.mockClear();
  toast.success.mockClear();
});

describe("answers posted from the plan document frame", () => {
  it("waits for a click on the page's own control before reaching chat", () => {
    const onSent = vi.fn();
    offerFrameQuestionAnswers({
      summary: "Q1: Use the existing table",
      context: "plan context",
      t,
      onSent,
    });

    expect(sendToAgentChat).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();

    const [message, options] = toast.mock.calls[0] ?? [];
    expect(message).toBe("plansPage.reader.sendAnswersPrompt");
    options.action.onClick();

    expect(sendToAgentChat).toHaveBeenCalledTimes(1);
    expect(sendToAgentChat.mock.calls[0]?.[0]).toMatchObject({
      submit: true,
      context: "plan context",
    });
    expect(sendToAgentChat.mock.calls[0]?.[0].message).toContain(
      "Q1: Use the existing table",
    );
    expect(onSent).toHaveBeenCalledTimes(1);
  });
});
