// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttachFromContentButton } from "./AttachFromContentButton";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  toastUploadFailure: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: mocks.callAction,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
vi.mock("@/hooks/use-can-manage-storage", () => ({
  useCanManageStorage: () => false,
}));
vi.mock("@/hooks/use-storage-setup-labels", () => ({
  useStorageSetupLabels: () => ({}),
}));
vi.mock("@/lib/upload-toast", () => ({
  toastUploadFailure: mocks.toastUploadFailure,
}));

const page = { id: "plan", title: "Plan", kind: "page", format: "markdown" };
const attachment = {
  id: "upload-1",
  filename: "Plan.pdf",
  mimeType: "application/pdf",
  size: 1200,
};

function renderButton() {
  const onAttach = vi.fn();
  const onPendingChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AttachFromContentButton
        onAttach={onAttach}
        onPendingChange={onPendingChange}
      />
    </QueryClientProvider>,
  );
  return { onAttach, onPendingChange };
}

async function choosePlan() {
  fireEvent.click(
    screen.getByRole("button", { name: "mail.compose.attachFromContent" }),
  );
  fireEvent.click(await screen.findByText("Plan"));
}

function attachCalls() {
  return mocks.callAction.mock.calls.filter(
    ([name]) => name === "attach-content-page",
  );
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  mocks.callAction.mockImplementation(async (name: string) =>
    name === "list-content-pages"
      ? { items: [page], hasMore: false }
      : { attachment },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("AttachFromContentButton", () => {
  it("attaches a page as a PDF first, and as Markdown once chosen", async () => {
    const { onAttach, onPendingChange } = renderButton();

    await choosePlan();
    await waitFor(() => expect(onAttach).toHaveBeenCalledWith(attachment));
    expect(onPendingChange.mock.calls).toEqual([[true], [false]]);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.compose.attachFromContent" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "mail.compose.contentFormatMarkdown",
      }),
    );
    fireEvent.click(await screen.findByText("Plan"));
    await waitFor(() => expect(onAttach).toHaveBeenCalledTimes(2));

    expect(attachCalls().map(([, input]) => input)).toEqual([
      { id: "plan", format: "pdf" },
      { id: "plan", format: "markdown" },
    ]);
  });

  it("sets a PDF in the font picked, remembers it, and offers no font for Markdown", async () => {
    const first = renderButton();

    fireEvent.click(
      screen.getByRole("button", { name: "mail.compose.attachFromContent" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "mail.compose.contentFontSerif",
      }),
    );
    fireEvent.click(await screen.findByText("Plan"));
    await waitFor(() => expect(first.onAttach).toHaveBeenCalledTimes(1));
    cleanup();

    const second = renderButton();
    fireEvent.click(
      screen.getByRole("button", { name: "mail.compose.attachFromContent" }),
    );
    expect(
      (
        await screen.findByRole("button", {
          name: "mail.compose.contentFontSerif",
        })
      ).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(
      screen.getByRole("button", {
        name: "mail.compose.contentFormatMarkdown",
      }),
    );
    expect(
      screen.queryByRole("group", { name: "mail.compose.contentPdfFont" }),
    ).toBeNull();
    fireEvent.click(await screen.findByText("Plan"));
    await waitFor(() => expect(second.onAttach).toHaveBeenCalledTimes(1));

    expect(attachCalls().map(([, input]) => input)).toEqual([
      { id: "plan", format: "pdf", font: "serif" },
      { id: "plan", format: "markdown" },
    ]);
  });

  it.each([
    [
      "document_file_pdf_text_unsupported",
      "mail.toasts.contentPagePdfTextUnsupported",
    ],
    ["document_file_pdf_too_long", "mail.toasts.contentPagePdfTooLong"],
    ["content_page_pdf_unavailable", "mail.toasts.contentPagePdfUnavailable"],
    ["document_file_unavailable", "Content's own words"],
  ])(
    "shows the refusal %s in the person's language when Mail has it",
    async (errorCode, shown) => {
      mocks.callAction.mockImplementation(async (name: string) => {
        if (name === "list-content-pages")
          return { items: [page], hasMore: false };
        throw Object.assign(new Error("Content's own words"), {
          errorCode,
          actionMessage: "Content's own words",
        });
      });
      const { onAttach, onPendingChange } = renderButton();

      await choosePlan();
      await waitFor(() => expect(mocks.toastUploadFailure).toHaveBeenCalled());
      await waitFor(() =>
        expect(onPendingChange.mock.calls).toEqual([[true], [false]]),
      );

      expect(mocks.toastUploadFailure).toHaveBeenCalledWith(
        expect.objectContaining({ message: shown }),
        "mail.toasts.failedToAttachContentPage",
        {},
        false,
      );
      expect(onAttach).not.toHaveBeenCalled();
    },
  );
});
