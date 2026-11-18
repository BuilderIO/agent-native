// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { SignedOutRefreshSetup } from "./root";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("signed-out board refresh", () => {
  it("refetches design reads when this tab's WebMCP write asks for a refresh", async () => {
    const client = new QueryClient();
    client.setQueryData(["action", "get-design", { id: "d1" }], { files: [] });
    client.setQueryData(["session"], { email: null });
    client.setQueryData(
      ["action", "get-localhost-write-consent-request", {}],
      null,
    );
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <SignedOutRefreshSetup />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agentNative:refresh-data"));
    });

    expect(
      client.getQueryState(["action", "get-design", { id: "d1" }])
        ?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(["session"])?.isInvalidated).toBe(false);
    expect(
      client.getQueryState([
        "action",
        "get-localhost-write-consent-request",
        {},
      ])?.isInvalidated,
    ).toBe(true);

    await act(async () => root.unmount());
    client.setQueryData(["action", "get-design", { id: "d1" }], { files: [] });
    window.dispatchEvent(new CustomEvent("agentNative:refresh-data"));
    expect(
      client.getQueryState(["action", "get-design", { id: "d1" }])
        ?.isInvalidated,
    ).toBe(false);
  });
});
