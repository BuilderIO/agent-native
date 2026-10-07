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

it("preserves safe video playback in standalone HTML exports", () => {
  const html = buildStandaloneHtml("Video deck", [
    {
      id: "video-slide",
      content:
        '<video autoplay><source src="https://media.example.com/clip.mp4" type="video/mp4"><source src="javascript:alert(1)" type="video/webm"></video>',
    },
  ]);

  expect(html).toContain("<video autoplay");
  expect(html).toContain('src="https://media.example.com/clip.mp4"');
  expect(html).toMatch(/<video[^>]*\bmuted\b/);
  expect(html).toMatch(/<video[^>]*\bplaysinline\b/);
  expect(html).not.toContain("javascript:");
});

it("keeps video controls from navigating or continuing playback off-slide", async () => {
  const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
  const html = buildStandaloneHtml("Video deck", [
    {
      id: "video-slide",
      content:
        '<video controls><source src="https://media.example.com/clip.mp4" type="video/mp4"></video>',
    },
    { id: "next-slide", content: "<p>Next</p>" },
  ]);
  window.document.write(html);
  await window.happyDOM.whenAsyncComplete();

  const counter = window.document.getElementById("counter");
  const video = window.document.querySelector("video");
  const viewport = window.document.getElementById("viewport");
  const pause = vi.fn();
  if (!video || !viewport) throw new Error("Expected exported video slide");
  video.pause = pause;

  video.click();
  expect(counter?.textContent).toBe("1 / 2");

  for (const key of [" ", "ArrowRight"]) {
    const event = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    video.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(counter?.textContent).toBe("1 / 2");
  }

  video.focus();
  expect(window.document.activeElement).toBe(video);
  for (const key of [" ", "ArrowRight"]) {
    const event = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    window.document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(counter?.textContent).toBe("1 / 2");
  }

  viewport.click();
  expect(counter?.textContent).toBe("2 / 2");
  expect(pause).toHaveBeenCalledTimes(1);
  await window.happyDOM.abort();
});

it("keeps fullscreen shortcuts available while video controls are focused", async () => {
  const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
  const html = buildStandaloneHtml("Video deck", [
    {
      id: "video-slide",
      content:
        '<video controls><source src="https://media.example.com/clip.mp4" type="video/mp4"></video>',
    },
    { id: "next-slide", content: "<p>Next</p>" },
  ]);
  window.document.write(html);
  await window.happyDOM.whenAsyncComplete();

  const video = window.document.querySelector("video");
  const counter = window.document.getElementById("counter");
  if (!video) throw new Error("Expected exported video slide");

  let fullscreenElement: Element | null = null;
  const requestFullscreen = vi.fn().mockResolvedValue(undefined);
  const exitFullscreen = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  Object.defineProperty(window.document.documentElement, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  Object.defineProperty(window.document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });

  video.focus();
  const fullscreenShortcut = new window.KeyboardEvent("keydown", {
    key: "f",
    bubbles: true,
    cancelable: true,
  });
  window.document.dispatchEvent(fullscreenShortcut);
  expect(requestFullscreen).toHaveBeenCalledTimes(1);
  expect(fullscreenShortcut.defaultPrevented).toBe(false);

  fullscreenElement = window.document.documentElement;
  const exitShortcut = new window.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  window.document.dispatchEvent(exitShortcut);
  expect(exitFullscreen).toHaveBeenCalledTimes(1);
  expect(exitShortcut.defaultPrevented).toBe(false);
  expect(counter?.textContent).toBe("1 / 2");

  await window.happyDOM.abort();
});

it("leaves Home and End available to focused media controls", async () => {
  const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
  const html = buildStandaloneHtml("Video deck", [
    {
      id: "first-video",
      content:
        '<video controls><source src="https://media.example.com/first.mp4" type="video/mp4"></video>',
    },
    {
      id: "second-video",
      content:
        '<video controls><source src="https://media.example.com/second.mp4" type="video/mp4"></video>',
    },
    { id: "last-slide", content: "<p>Last</p>" },
  ]);
  window.document.write(html);
  await window.happyDOM.whenAsyncComplete();

  const counter = window.document.getElementById("counter");
  const next = window.document.getElementById("nextSlide") as HTMLButtonElement;
  const videos = window.document.querySelectorAll("video");
  const video = videos[1];
  if (!video) throw new Error("Expected second exported video slide");

  next.click();
  expect(counter?.textContent).toBe("2 / 3");
  video.focus();
  expect(window.document.activeElement).toBe(video);

  for (const key of ["Home", "End"]) {
    const event = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    window.document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(counter?.textContent).toBe("2 / 3");
  }

  await window.happyDOM.abort();
});
