// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  flagOn: true,
  probe: vi.fn(async (_src: string) => false),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: (key: string) =>
    key === "content.clip-embed" ? state.flagOn : false,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) =>
    name === "get-clips-links"
      ? {
          data: {
            appUrl: "https://clips.example.test",
            linkOrigins: [
              "https://clips.example.test",
              "https://beta.clips.example.test",
            ],
          },
          isSuccess: true,
          isError: false,
        }
      : { data: undefined, isSuccess: false, isError: false },
}));

vi.mock("./video-link-probe", () => ({
  probeVideoSource: state.probe,
}));

import { VideoLinkForm } from "./VideoLinkForm";

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

let root: Root | null = null;
let container: HTMLDivElement;
const onVideo = vi.fn();
const onClip = vi.fn();

function render() {
  act(() =>
    defined(root).render(
      <VideoLinkForm replace={false} onVideo={onVideo} onClip={onClip} />,
    ),
  );
}

async function submit(link: string) {
  const input = defined(container.querySelector("input"));
  act(() => {
    const setValue = defined(
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set,
    );
    setValue.call(input, link);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    defined(container.querySelector("form")).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

const refusal = () => container.querySelector('[role="alert"]')?.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  state.flagOn = true;
  state.probe.mockResolvedValue(false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  render();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
});

describe("VideoLinkForm", () => {
  it.each([
    "https://clips.example.test/r/rec_1",
    "https://clips.example.test/share/rec_1?t=12",
    "https://beta.clips.example.test/embed/rec_1",
  ])("turns the Clips link %s into a Clip block", async (link) => {
    await submit(link);
    expect(onClip).toHaveBeenCalledWith("rec_1");
    expect(onVideo).not.toHaveBeenCalled();
    expect(state.probe).not.toHaveBeenCalled();
  });

  it("refuses a Clips link while Clips in pages are off", async () => {
    state.flagOn = false;
    render();
    await submit("https://clips.example.test/share/rec_1");
    expect(refusal()).toBe("clipEmbed.linkClipsDisabled");
    expect(onClip).not.toHaveBeenCalled();
    expect(onVideo).not.toHaveBeenCalled();
  });

  it("refuses a YouTube link without loading it", async () => {
    await submit("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(refusal()).toBe("clipEmbed.linkVideoPage");
    expect(state.probe).not.toHaveBeenCalled();
    expect(onVideo).not.toHaveBeenCalled();
  });

  it("refuses a web page the browser can't play", async () => {
    await submit("https://example.test/about");
    expect(state.probe).toHaveBeenCalledWith("https://example.test/about");
    expect(refusal()).toBe("clipEmbed.linkNotVideo");
    expect(onVideo).not.toHaveBeenCalled();
  });

  it("refuses a Clips-shaped link on another origin unless it plays", async () => {
    await submit("https://elsewhere.example.test/share/rec_1");
    expect(onClip).not.toHaveBeenCalled();
    expect(refusal()).toBe("clipEmbed.linkNotVideo");
  });

  it("embeds only a link the browser plays, whatever its file name", async () => {
    await submit("https://cdn.example.test/demo.mp4");
    expect(state.probe).toHaveBeenCalledWith(
      "https://cdn.example.test/demo.mp4",
    );
    expect(refusal()).toBe("clipEmbed.linkNotVideo");
    expect(onVideo).not.toHaveBeenCalled();

    state.probe.mockResolvedValue(true);
    await submit("https://cdn.example.test/stream?id=7");
    expect(onVideo).toHaveBeenLastCalledWith(
      "https://cdn.example.test/stream?id=7",
    );
  });

  it("refuses what isn't a web link", async () => {
    await submit("javascript:alert(1)");
    expect(refusal()).toBe("editor.media.pasteValidVideoUrl");
  });
});
