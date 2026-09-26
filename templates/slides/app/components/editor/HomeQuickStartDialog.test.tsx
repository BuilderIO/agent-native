// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/en-US";

import { MAX_REFERENCE_FILE_BYTES } from "../../../shared/upload-types";
const translate = (key: string, args?: Record<string, unknown>): string => {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown>)?.[part],
      en,
    );
  return typeof value === "string"
    ? value
    : typeof args?.defaultValue === "string"
      ? args.defaultValue
      : key;
};
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => translate }));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
}));
import { HomeQuickStartDialog } from "./HomeQuickStartDialog";
afterEach(cleanup);
describe("home structured quick starts", () => {
  it("requires source input and sends notes only as hidden context", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true),
      onClose = vi.fn();
    render(
      <HomeQuickStartDialog
        kind="notes"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Generate",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Meeting notes"), {
      target: { value: "Decision: launch the sample project next week." },
    });
    fireEvent.click(button);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const [intent, files, context] = onSubmit.mock.calls[0];
    expect(intent).toBe(en.home.quickStart.notes.prompt);
    expect(intent).not.toContain("sample project");
    expect(files).toEqual([]);
    expect(context).toContain("Decision: launch the sample project next week.");
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("keeps website source out of the visible intent", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <HomeQuickStartDialog
        kind="website"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText("Company website URL"), {
      target: { value: "https://example.test/company" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).not.toContain("https://");
    expect(onSubmit.mock.calls[0][2]).toContain("https://example.test/company");
  });
  it.each([
    ["wrong.txt", "application/pdf", 1],
    ["wrong.pdf", "text/plain", 1],
    ["large.pdf", "application/pdf", MAX_REFERENCE_FILE_BYTES + 1],
  ])(
    "rejects invalid PDF %s/%s/%i before submission",
    async (name, type, size) => {
      const onSubmit = vi.fn();
      render(
        <HomeQuickStartDialog
          kind="pdf"
          onClose={vi.fn()}
          onSubmit={onSubmit}
        />,
      );
      const file = new File(["x"], name, { type });
      Object.defineProperty(file, "size", { value: size });
      fireEvent.change(screen.getByLabelText("PDF file"), {
        target: { files: [file] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );
  it("passes the actual PDF through the existing submission callback", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <HomeQuickStartDialog kind="pdf" onClose={vi.fn()} onSubmit={onSubmit} />,
    );
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("PDF file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        en.home.quickStart.pdf.prompt,
        [file],
        expect.stringContaining("brief.pdf"),
      ),
    );
  });
  it("shows actionable feedback and retains the source when composer submission returns false", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false),
      onClose = vi.fn();
    render(
      <HomeQuickStartDialog
        kind="trends"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText("Industry or topic"), {
      target: { value: "Renewable energy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      en.home.quickStart.notReady,
    );
    expect(
      (screen.getByLabelText("Industry or topic") as HTMLInputElement).value,
    ).toBe("Renewable energy");
    expect(onClose).not.toHaveBeenCalled();
  });
  it("explains the existing connection path instead of a silent disabled action", async () => {
    const onSubmit = vi.fn();
    render(
      <HomeQuickStartDialog
        kind="trends"
        connectionRequired
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText("Industry or topic"), {
      target: { value: "Energy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      en.home.quickStart.connectionRequired,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
