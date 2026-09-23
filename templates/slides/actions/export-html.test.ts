import { Window } from "happy-dom";
import { expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({}));
vi.mock("@agent-native/core/server/request-context", () => ({}));
vi.mock("@agent-native/core/sharing", () => ({}));
vi.mock("@agent-native/core/tracking", () => ({}));
vi.mock("../server/db/index.js", () => ({}));

import { buildStandaloneHtml } from "./export-html";

it("navigates exported slides with controls and keyboard", async () => {
  const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
  const html = buildStandaloneHtml("Deck", [
    { id: "one", content: "<p>First</p>" },
    { id: "two", content: "<p>Second</p>" },
  ]);
  expect(html).toContain("@media (hover: none), (any-pointer: coarse)");
  expect(html).toContain(
    "else if (document.documentElement.requestFullscreen)",
  );
  expect(html).toContain("else if (document.exitFullscreen)");
  expect(html).toContain(
    "document.fullscreenElement && document.exitFullscreen",
  );
  window.document.write(html);
  await window.happyDOM.whenAsyncComplete();

  const counter = window.document.getElementById("counter");
  const previous = window.document.getElementById(
    "previousSlide",
  ) as HTMLButtonElement;
  const next = window.document.getElementById("nextSlide") as HTMLButtonElement;
  expect(previous.disabled).toBe(true);

  next.click();
  expect(counter?.textContent).toBe("2 / 2");
  expect(next.disabled).toBe(true);

  window.document.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowLeft" }),
  );
  expect(counter?.textContent).toBe("1 / 2");
  await window.happyDOM.abort();
});
