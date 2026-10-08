// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderUi } from "@/test-utils/render-ui";

const widgetHost = vi.hoisted(() => ({ embedded: false }));

// The real hook latches for the life of the document, so one test file could
// not show both the widget and the app.
vi.mock("@agent-native/core/client/mcp-app-host", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/mcp-app-host")
  >()),
  useIsMcpAppWidgetEmbed: () => widgetHost.embedded,
}));

import { useNotionConnection } from "./use-notion";

function Probe({
  onResult,
}: {
  onResult: (result: ReturnType<typeof useNotionConnection>) => void;
}) {
  onResult(useNotionConnection());
  return null;
}

async function mountConnection(embedded: boolean) {
  widgetHost.embedded = embedded;
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ connected: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  let latest: ReturnType<typeof useNotionConnection> | undefined;
  renderUi(<Probe onResult={(result) => (latest = result)} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return { fetchMock, result: () => latest! };
}

const requestedStatus = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.some(([input]) =>
    String(input).includes("connect-notion-status"),
  );

afterEach(() => {
  widgetHost.embedded = false;
  vi.unstubAllGlobals();
});

describe("useNotionConnection", () => {
  it("asks for the workspace's Notion connection in the app", async () => {
    const { fetchMock, result } = await mountConnection(false);

    expect(requestedStatus(fetchMock)).toBe(true);
    expect(result().data).toEqual({ connected: false });
  });

  it("makes no request inside an MCP App widget and reports nothing as known", async () => {
    const { fetchMock, result } = await mountConnection(true);

    expect(requestedStatus(fetchMock)).toBe(false);
    expect(result().data).toBeUndefined();
    expect(result().isSuccess).toBe(false);
    expect(result().fetchStatus).toBe("idle");
  });
});
