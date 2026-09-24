// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

import { SendLaterButton } from "./SendLaterButton";

afterEach(cleanup);

describe("SendLaterButton", () => {
  it("disables both send controls while scheduling", () => {
    const markup = renderToStaticMarkup(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <SendLaterButton onSend={vi.fn()} onSendLater={vi.fn()} isScheduling />
      </AgentNativeI18nProvider>,
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("previews natural-language dates and schedules only after selection", () => {
    const onSendLater = vi.fn((runAt: number) => runAt);

    render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <SendLaterButton onSend={vi.fn()} onSendLater={onSendLater} />
      </AgentNativeI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Schedule send" }));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "tomorrow afternoon" } });

    expect(onSendLater).not.toHaveBeenCalled();
    const listbox = document.getElementById(
      input.getAttribute("aria-controls") ?? "",
    );
    if (!listbox) throw new Error("Missing suggestion listbox");
    expect(within(listbox).getByRole("option").textContent).toContain(
      "1:00 PM",
    );

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSendLater).toHaveBeenCalledTimes(1);
    expect(onSendLater).toHaveBeenCalledWith(expect.any(Number));
    expect(onSendLater.mock.calls[0][0]).toBeGreaterThan(Date.now());
  });

  it("requires explicit keyboard navigation before scheduling a blank preset", () => {
    const onSendLater = vi.fn();

    render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <SendLaterButton onSend={vi.fn()} onSendLater={onSendLater} />
      </AgentNativeI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Schedule send" }));
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSendLater).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSendLater).toHaveBeenCalledTimes(1);
  });

  it("wraps ArrowUp to the last blank preset and commits it with Enter", () => {
    const onSendLater = vi.fn();

    render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <SendLaterButton onSend={vi.fn()} onSendLater={onSendLater} />
      </AgentNativeI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Schedule send" }));
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toMatch(/option-2$/);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSendLater).toHaveBeenCalledTimes(1);
  });

  it("shows an actionable no-match state without scheduling invalid input", () => {
    const onSendLater = vi.fn();

    render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <SendLaterButton onSend={vi.fn()} onSendLater={onSendLater} />
      </AgentNativeI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Schedule send" }));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "not a date" } });

    expect(screen.getByRole("status").textContent).toContain(
      "No matching future time",
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSendLater).not.toHaveBeenCalled();
  });

  it("commits a clicked natural-language suggestion", () => {
    const onSendLater = vi.fn();

    render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <SendLaterButton onSend={vi.fn()} onSendLater={onSendLater} />
      </AgentNativeI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Schedule send" }));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Monday 9:45am" } });
    const listbox = document.getElementById(
      input.getAttribute("aria-controls") ?? "",
    );
    if (!listbox) throw new Error("Missing suggestion listbox");
    fireEvent.click(within(listbox).getByRole("option"));

    expect(onSendLater).toHaveBeenCalledTimes(1);
    expect(onSendLater.mock.calls[0][0]).toBeGreaterThan(Date.now());
  });

  it("keeps the native picker out of tab order and falls back when showPicker is unavailable", () => {
    render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <SendLaterButton onSend={vi.fn()} onSendLater={vi.fn()} />
      </AgentNativeI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Schedule send" }));
    const dateInput = document.querySelector<HTMLInputElement>(
      'input[type="datetime-local"]',
    );
    if (!dateInput) throw new Error("Missing native date-time input");

    expect(dateInput.getAttribute("aria-hidden")).toBe("true");
    expect(dateInput.tabIndex).toBe(-1);
    const pickerButton = screen.getByRole("button", {
      name: "Pick date & time...",
    });
    expect(pickerButton.getAttribute("aria-controls")).toBe(dateInput.id);

    Object.defineProperty(dateInput, "showPicker", {
      configurable: true,
      value: undefined,
    });
    const clickSpy = vi.spyOn(dateInput, "click");
    fireEvent.click(pickerButton);

    expect(clickSpy).toHaveBeenCalledOnce();
    clickSpy.mockRestore();
  });

  it("clears the date query on the first Escape and closes on the second", async () => {
    render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <SendLaterButton onSend={vi.fn()} onSendLater={vi.fn()} />
      </AgentNativeI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Schedule send" }));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Monday 9:45am" } });

    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("combobox")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Schedule send" }));
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
  });
});
