// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/en-US";

const translate = (key: string) =>
  (key
    .split(".")
    .reduce<unknown>(
      (value, part) => (value as Record<string, unknown> | undefined)?.[part],
      en,
    ) as string) || key;
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => translate }));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: { actionMessage?: unknown } | undefined) =>
    typeof error?.actionMessage === "string" ? error.actionMessage : undefined,
}));
vi.mock("./GoogleDriveConnectionCta", () => ({
  GoogleDriveConnectionCta: () => (
    <button type="button">Connect Google Drive</button>
  ),
}));

import {
  GoogleSlidesLinkComposerBubble,
  useDetectedGoogleSlidesComposerLink,
} from "./GoogleSlidesLinkComposerBubble";
import { usePromptImport, type PromptImportHandler } from "./use-prompt-import";

const deckUrl = "https://docs.google.com/presentation/d/example-deck_id/edit";

function Harness({
  onImport,
  onSend,
}: {
  onImport: PromptImportHandler;
  onSend?: (text: string) => void;
}) {
  const controller = usePromptImport({ onImport });
  const { url, onComposerTextChange } = useDetectedGoogleSlidesComposerLink();
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSend?.(text);
      }}
    >
      {url ? (
        <GoogleSlidesLinkComposerBubble url={url} controller={controller} />
      ) : null}
      <textarea
        aria-label="Prompt"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onComposerTextChange(event.target.value);
        }}
      />
    </form>
  );
}

function type(text: string) {
  fireEvent.change(screen.getByLabelText("Prompt"), {
    target: { value: text },
  });
}

afterEach(() => {
  cleanup();
});

describe("Google Slides link in the home composer", () => {
  it("offers an import only while the prompt contains a Google Slides link", () => {
    render(<Harness onImport={vi.fn()} />);
    type("Make a deck about https://docs.google.com/document/d/a-doc-id");
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    type(`Restyle ${deckUrl}.`);
    expect(screen.getByRole("button", { name: "Import" })).toBeTruthy();
    expect(screen.getByText("Google Slides").getAttribute("title")).toBe(
      deckUrl,
    );
    type("Restyle it");
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
  });

  it("imports the detected link only after the user confirms", async () => {
    const onImport = vi.fn().mockResolvedValue(true);
    render(<Harness onImport={onImport} />);
    type(`Use ${deckUrl}`);
    expect(onImport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledExactlyOnceWith({
        kind: "google-slides",
        url: deckUrl,
      }),
    );
  });

  it("shows the Google Drive connection prompt with the offer", () => {
    render(<Harness onImport={vi.fn()} />);
    type(deckUrl);
    expect(
      screen.getByRole("button", { name: "Connect Google Drive" }),
    ).toBeTruthy();
  });

  it("shows a pending state, then the failure, and retries from the same button", async () => {
    let reject!: (reason: Error) => void;
    const onImport = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(true);
    render(<Harness onImport={onImport} />);
    type(deckUrl);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const pending = await screen.findByRole("button", {
      name: "Importing...",
    });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    await act(async () =>
      reject(
        Object.assign(new Error("action failed"), {
          actionMessage: "Reconnect Google Drive",
        }),
      ),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Reconnect Google Drive",
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("leaves the prompt intact and sendable when the offer is ignored", () => {
    const onImport = vi.fn();
    const onSend = vi.fn();
    render(<Harness onImport={onImport} onSend={onSend} />);
    const prompt = `Summarize ${deckUrl} in five slides`;
    type(prompt);
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe(
      prompt,
    );
    const form = screen.getByLabelText("Prompt").closest("form");
    if (!form) throw new Error("Composer form is missing");
    fireEvent.submit(form);
    expect(onSend).toHaveBeenCalledExactlyOnceWith(prompt);
    expect(onImport).not.toHaveBeenCalled();
  });
});
