// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CodeRequiredDialog } from "./CodeRequiredDialog.js";

describe("CodeRequiredDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              configured: true,
              builderEnabled: false,
              connectUrl: "/_agent-native/builder/connect?_an_connect=signed",
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not imply Builder Cloud Agents can run when the flag is off", async () => {
    await act(async () => {
      root.render(
        <CodeRequiredDialog
          open
          onClose={() => {}}
          featureLabel="Update the dashboard layout"
        />,
      );
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "This requires a code change",
      );
    });
    expect(document.body.textContent).toContain(
      "Edit locally or use Builder.io to edit this code in the cloud and continue customizing the app any way you like.",
    );
    expect(document.body.textContent).not.toContain(
      "Builder Cloud Agents coming soon",
    );
  });

  it("does not offer agents-run when OAuth is connected without legacy Builder keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              configured: true,
              builderEnabled: true,
              privateKeyConfigured: false,
              publicKeyConfigured: false,
              connectUrl: "/_agent-native/builder/connect?_an_connect=signed",
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await act(async () => {
      root.render(
        <CodeRequiredDialog
          open
          onClose={() => {}}
          featureLabel="Update the dashboard layout"
        />,
      );
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "This requires a code change",
      );
    });
    expect(document.body.textContent).not.toContain("Use Builder.io Agent");
  });
  function stubAgentsRun(response: () => Response) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/builder/agents-run")
        ? response()
        : new Response(
            JSON.stringify({
              configured: true,
              builderEnabled: true,
              privateKeyConfigured: true,
              publicKeyConfigured: true,
              connectUrl: "/_agent-native/builder/connect?_an_connect=signed",
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function runBuilderAgent() {
    await act(async () => {
      root.render(
        <CodeRequiredDialog
          open
          onClose={() => {}}
          featureLabel="Update the dashboard layout"
        />,
      );
    });
    const runButton = await vi.waitFor(() => {
      const button = Array.from(document.body.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.includes("Use Builder.io Agent"),
      );
      expect(button).toBeTruthy();
      return button!;
    });
    await act(async () => runButton.click());
  }

  it("starts a Builder agents run through the shared helper and links the branch", async () => {
    const fetchMock = stubAgentsRun(
      () =>
        new Response(
          JSON.stringify({ url: "https://builder.example.test/branch/1" }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );

    await runBuilderAgent();

    await vi.waitFor(() => {
      expect(
        document.body.querySelector(
          'a[href="https://builder.example.test/branch/1"]',
        ),
      ).not.toBeNull();
    });
    const runCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/builder/agents-run"),
    );
    expect(JSON.parse(String(runCall?.[1]?.body))).toEqual({
      userMessage: "Update the dashboard layout",
    });
  });

  it("names a missing Builder agent connection instead of a generic failure", async () => {
    stubAgentsRun(
      () =>
        new Response(
          JSON.stringify({
            error: "Not connected",
            errorCode: "builder_agent_not_connected",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
    );

    await runBuilderAgent();

    await vi.waitFor(() => {
      expect(
        document.body.querySelector('[role="alert"]')?.textContent,
      ).toContain("Builder Cloud Agents aren't connected.");
    });
  });
});
