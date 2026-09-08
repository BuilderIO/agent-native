import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SendLaterButton } from "./SendLaterButton";

describe("SendLaterButton", () => {
  it("disables both send controls while scheduling", () => {
    const markup = renderToStaticMarkup(
      <AgentNativeI18nProvider persistPreference={false}>
        <SendLaterButton onSend={vi.fn()} onSendLater={vi.fn()} isScheduling />
      </AgentNativeI18nProvider>,
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });
});
