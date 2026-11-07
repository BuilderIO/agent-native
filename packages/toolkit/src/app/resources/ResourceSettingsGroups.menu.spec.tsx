// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { DropdownMenuItem } from "@agent-native/toolkit/ui/dropdown-menu";

import { RowMenuTrigger } from "./ResourceSettingsGroups.js";

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = "";
});

describe("resource row menu", () => {
  it("does not lock pointer input while the menu is open", async () => {
    render(
      <RowMenuTrigger>
        <DropdownMenuItem>Remove</DropdownMenuItem>
      </RowMenuTrigger>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "agentChat.settingsResources.moreActions",
      }),
      { button: 0 },
    );
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Remove" })).toBeTruthy(),
    );
    expect(document.body.style.pointerEvents).not.toBe("none");
  });
});
