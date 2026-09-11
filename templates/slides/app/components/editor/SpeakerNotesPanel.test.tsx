// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { SpeakerNotesPanel } from "./SpeakerNotesPanel";

afterEach(() => cleanup());

describe("<SpeakerNotesPanel>", () => {
  it("lights the label when the clickable header is hovered", () => {
    const { getByRole } = render(
      <SpeakerNotesPanel notes="" onChange={() => {}} />,
    );
    const button = getByRole("button", { name: "raw.speakerNotes" });
    const label = button.querySelector("span");

    expect(button.className).toContain("group");
    expect(label?.className).toContain("transition-colors");
    expect(label?.className).toContain("group-hover:text-foreground/80");
  });
});
