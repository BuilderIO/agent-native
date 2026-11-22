// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { AgentPanel } from "./AgentPanel.js";

describe("AgentPanel page header title", () => {
  afterEach(cleanup);

  it("uses newUiTabLabel for an empty unnamed chat", async () => {
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AgentPanel
            showHeader={false}
            showPageHeader
            showPageHeaderWhenEmpty
            newUiTabLabel="New AI chat"
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      const title = container.querySelector("[data-agent-page-chat-header] h1");
      expect(title?.textContent).toBe("New AI chat");
    });
  });
});
