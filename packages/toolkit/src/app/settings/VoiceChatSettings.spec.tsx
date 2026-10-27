// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({
  read: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: appState.read,
  setClientAppState: appState.set,
}));

// A native select stands in for the Radix one so the test can pick. The
// options come from the SelectItems, the name from the SelectTrigger.
vi.mock("@agent-native/toolkit/ui/select", () => {
  type Props = { children?: React.ReactNode; [key: string]: unknown };
  const SelectTrigger = (_props: Props) => null;
  const SelectItem = (_props: Props) => null;
  const Passthrough = ({ children }: Props) => <>{children}</>;
  const collect = (
    children: React.ReactNode,
    found: { label?: string; options: { value: string; label: string }[] },
  ) => {
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement<Props>(child)) return;
      if (child.type === SelectTrigger) {
        found.label = child.props["aria-label"] as string;
      } else if (child.type === SelectItem) {
        found.options.push({
          value: child.props.value as string,
          label: String(child.props.children),
        });
      } else {
        collect(child.props.children, found);
      }
    });
    return found;
  };
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) => {
      const { label, options } = collect(children, { options: [] });
      return (
        <select
          aria-label={label}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    },
    SelectContent: Passthrough,
    SelectGroup: Passthrough,
    SelectItem,
    SelectTrigger,
    SelectValue: () => null,
  };
});

import { REALTIME_VOICE_PREFERENCES_KEY } from "../../composer/useRealtimeVoiceMode.js";
import { createToolkitI18nCatalog } from "../i18n.js";
import { VoiceChatSettings } from "./VoiceChatSettings.js";

const catalog = createToolkitI18nCatalog({ messages: {} });
const MICROPHONE_STORAGE_KEY = "agent-native:realtime-voice-microphone";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  appState.read.mockReset();
  appState.set.mockReset();
  appState.read.mockResolvedValue({
    language: "fr",
    intelligence: "deep",
    voice: "cedar",
  });
  appState.set.mockImplementation(async (_key, value) => value);
  window.localStorage.removeItem(MICROPHONE_STORAGE_KEY);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: vi.fn(async () => [
        { kind: "audioinput", deviceId: "default", label: "Default" },
        { kind: "audioinput", deviceId: "studio", label: "Studio mic" },
        { kind: "videoinput", deviceId: "camera", label: "Camera" },
      ]),
    },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => {
    root.render(
      <AgentNativeI18nProvider catalog={catalog} persistPreference={false}>
        <VoiceChatSettings />
      </AgentNativeI18nProvider>,
    );
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

const select = (label: string) =>
  container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);

async function choose(label: string, value: string) {
  await act(async () => {
    const element = select(label)!;
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("VoiceChatSettings", () => {
  it("shows every voice chat setting from the saved preferences", async () => {
    await render();

    expect(container.querySelector("#voice-chat h2")?.textContent).toBe(
      "Voice chat",
    );
    expect(appState.read).toHaveBeenCalledWith(REALTIME_VOICE_PREFERENCES_KEY);
    expect(select("Microphone")?.value).toBe("default");
    expect(
      [...select("Microphone")!.options].map((option) => option.textContent),
    ).toEqual(["System default", "Studio mic"]);
    expect(select("Language")?.value).toBe("fr");
    expect(select("Intelligence")?.value).toBe("deep");
    expect(select("Voice style")?.value).toBe("cedar");
    // Flat rows: a label and a control, no description under it.
    expect(container.querySelector("#voice-chat-language p")).toBeNull();
  });

  it("saves to the preference a voice chat session reads", async () => {
    await render();
    await choose("Language", "ja");
    await choose("Voice style", "marin");

    expect(appState.set).toHaveBeenLastCalledWith(
      REALTIME_VOICE_PREFERENCES_KEY,
      {
        language: "ja",
        intelligence: "deep",
        voice: "marin",
        intelligenceChosen: true,
      },
      { requestSource: "realtime-voice" },
    );
    expect(select("Voice style")?.value).toBe("marin");
  });

  it("remembers the microphone where a session picks its input", async () => {
    await render();
    await choose("Microphone", "studio");

    expect(window.localStorage.getItem(MICROPHONE_STORAGE_KEY)).toBe("studio");
    expect(select("Microphone")?.value).toBe("studio");
  });

  it("restores the choice and says so when a save fails", async () => {
    appState.set.mockRejectedValue(new Error("offline"));
    await render();
    await choose("Intelligence", "instant");

    expect(select("Intelligence")?.value).toBe("deep");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not save your voice chat settings.",
    );
  });

  it("offers a retry instead of defaults when the preferences cannot load", async () => {
    appState.read.mockRejectedValueOnce(new Error("offline"));
    await render();

    expect(select("Language")).toBeNull();
    expect(container.textContent).toContain(
      "Could not load your voice chat settings.",
    );
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => retry?.click());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(select("Language")?.value).toBe("fr");
  });
});
