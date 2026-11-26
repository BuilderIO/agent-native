import i18next from "i18next";
// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ActionError } from "../action-error.js";

const failure = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../use-action.js", async (original) => ({
  ...(await original<typeof import("../use-action.js")>()),
  useActionMutation: () => ({
    mutateAsync: () => Promise.reject(failure.value),
  }),
}));
import { useAccessRequestDecisions } from "./useAccessRequestReview.js";

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  document.body.innerHTML = "";
});
it.each([false, true])(
  "keeps the decision fallback available unless the app catalogs the refusal (mapped=%s)",
  async (mapped) => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: "en",
      initAsync: false,
      resources: {
        en: {
          translation: {
            actionErrors: {
              failed: "Generic failure",
              codes: mapped
                ? {
                    sharing_policy_denied:
                      "Your workspace sharing policy prevents this.",
                  }
                : {},
            },
          },
        },
      },
    });
    failure.value = new ActionError(
      Object.assign(new Error("Internal sharing diagnostic"), {
        status: 403,
        errorCode: "sharing_policy_denied",
        actionMessage: "Raw server explanation",
      }),
      instance,
    );
    function Probe() {
      const decisions = useAccessRequestDecisions(vi.fn());
      return (
        <>
          <button
            onClick={() => {
              void decisions
                .approve(
                  {
                    id: "request-1",
                    generation: 1,
                    requester: { email: "person@example.test", name: null },
                  },
                  "viewer",
                )
                .catch(() => {});
            }}
          >
            Allow
          </button>
          <output>{decisions.error?.message ?? "caller fallback"}</output>
        </>
      );
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Probe />));
    await act(async () => container.querySelector("button")?.click());
    expect(container.querySelector("output")?.textContent).toBe(
      mapped
        ? "Your workspace sharing policy prevents this."
        : "caller fallback",
    );
  },
);
