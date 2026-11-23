// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ProjectsListView } from "./ProjectsListView";

it("offers a retry when the project list fails to load", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onRetry = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ProjectsListView
        status="error"
        projects={[]}
        currentUser={{ name: "QA", email: "qa@workspace.test" }}
        search=""
        onSearchChange={() => {}}
        listView="active"
        onRetry={onRetry}
        fixture="fixture"
        now={Date.parse("2026-11-09T12:00:00.000Z")}
      />,
    ),
  );
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  expect(retry).toBeDefined();
  act(() => retry?.click());
  expect(onRetry).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  container.remove();
});
