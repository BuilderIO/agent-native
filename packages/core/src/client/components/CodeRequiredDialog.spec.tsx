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
              connectUrl: "https://builder.io/cli-auth",
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
});
