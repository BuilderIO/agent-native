// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { SpeakerNotesPanel } from "./SpeakerNotesPanel";

afterEach(() => cleanup());

function renderPanel(props: Partial<Parameters<typeof SpeakerNotesPanel>[0]>) {
  return render(
    <SpeakerNotesPanel
      notes=""
      onChange={() => {}}
      onClose={() => {}}
      onGenerate={() => {}}
      {...props}
    />,
  );
}

describe("<SpeakerNotesPanel>", () => {
  it("shows the placeholder and Generate when notes are empty", () => {
    const { getByPlaceholderText, getByRole } = renderPanel({});

    expect(getByPlaceholderText("speakerNotesPanel.placeholder")).toBeTruthy();
    expect(
      getByRole("button", { name: "speakerNotesPanel.generate" }),
    ).toBeTruthy();
  });

  it("offers Rewrite once notes exist", () => {
    const { getByRole } = renderPanel({ notes: "Hello" });

    expect(
      getByRole("button", { name: "speakerNotesPanel.rewrite" }),
    ).toBeTruthy();
  });

  it("reports edits, generate and close", () => {
    const onChange = vi.fn();
    const onGenerate = vi.fn();
    const onClose = vi.fn();
    const { getByRole } = renderPanel({ onChange, onGenerate, onClose });

    fireEvent.change(getByRole("textbox"), { target: { value: "Intro" } });
    fireEvent.click(
      getByRole("button", { name: "speakerNotesPanel.generate" }),
    );
    fireEvent.click(getByRole("button", { name: "speakerNotesPanel.close" }));

    expect(onChange).toHaveBeenCalledWith("Intro");
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hides Generate for read-only viewers", () => {
    const { queryByRole } = renderPanel({ readOnly: true });

    expect(
      queryByRole("button", { name: "speakerNotesPanel.generate" }),
    ).toBeNull();
  });
});
