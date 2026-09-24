// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  add: vi.fn(),
  read: vi.fn(),
  upload: vi.fn(),
  existing: null as Record<string, unknown> | null,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "start-design-system-authoring"
        ? mocks.create
        : name === "update-design-system"
          ? mocks.update
          : mocks.add,
    isPending: false,
  }),
  useActionQuery: () => ({
    data: mocks.existing,
    isLoading: false,
    isError: false,
  }),
  callAction: mocks.read,
}));
function translate(key: string, values: Record<string, string> = {}) {
  const value = key
    .split(".")
    .reduce<unknown>(
      (object, part) => (object as Record<string, unknown>)?.[part],
      messages,
    );
  if (typeof value !== "string") throw new Error(`Missing translation ${key}`);
  return value.replace(
    /\{\{(\w+)\}\}/g,
    (_, name: string) => values[name] ?? name,
  );
}
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => translate }));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  BuilderDsiGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./design-system-source-upload", () => ({
  uploadDesignSystemSourceFile: mocks.upload,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { DesignSystemSetup } from "./DesignSystemSetup";
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const input = (name: string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name }), {
    target: { value },
  });
const callbacks = () => ({
  onClose: vi.fn(),
  onComplete: vi.fn(),
  onCreated: vi.fn(),
});
function references() {
  input("Name", "Acme");
  fireEvent.click(screen.getByRole("radio", { name: "References" }));
  click("Continue");
}
function addUrl(kind: "Website" | "Figma", url: string) {
  click(kind);
  const region = screen.getByRole("region", { name: kind });
  fireEvent.change(within(region).getByRole("textbox"), {
    target: { value: url },
  });
  fireEvent.click(within(region).getByRole("button", { name: "Add" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.existing = null;
  mocks.create.mockResolvedValue({
    id: "slides-system",
    title: "Acme",
    canEdit: true,
    workspace: { revision: 0 },
  });
  mocks.upload.mockImplementation(async (file: File) => ({
    name: file.name,
    size: file.size,
    mimeType: file.type,
    handle: { kind: "stored-file", path: "private-source:fixture" },
  }));
  mocks.read.mockResolvedValue({
    id: "slides-system",
    canEdit: true,
    workspace: { revision: 3 },
  });
  mocks.add.mockResolvedValue({});
  mocks.update.mockResolvedValue({});
});
afterEach(cleanup);

describe("Slides creation adapter", () => {
  it("uses the shared radio cards and returns persisted native creation to its caller", async () => {
    const props = callbacks();
    render(<DesignSystemSetup open {...props} />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    input("Name", "Acme");
    click("Continue");
    await waitFor(() =>
      expect(props.onCreated).toHaveBeenCalledWith(
        "slides-system",
        expect.objectContaining({ title: "Acme" }),
      ),
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Acme", intent: "fresh", sources: [] }),
    );
  });

  it("stages all three kinds with real file handles and preserves unrelated items through Back/removal", async () => {
    render(<DesignSystemSetup open {...callbacks()} />);
    references();
    addUrl("Website", "https://example.com/brand");
    addUrl("Figma", "https://figma.com/design/ABC123/Brand");
    click("Brand files");
    const files = [
      new File(["# Brand"], "design.md", { type: "text/markdown" }),
      new File(["fixture"], "logo.png", { type: "image/png" }),
    ];
    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files },
    });
    fireEvent.click(
      within(screen.getByRole("region", { name: "Brand files" })).getByRole(
        "button",
        { name: "Add" },
      ),
    );
    await waitFor(() =>
      expect(screen.queryAllByText("Uploading…")).toHaveLength(0),
    );
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    click("Back");
    expect(
      (screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value,
    ).toBe("Acme");
    click("Continue");
    click("Remove logo.png");
    click("Create design system");
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][0].sources).toEqual([
      expect.objectContaining({ kind: "website" }),
      expect.objectContaining({ kind: "figma" }),
      expect.objectContaining({
        kind: "file",
        name: "design.md",
        handle: { kind: "stored-file", path: "private-source:fixture" },
      }),
    ]);
  });

  it("preserves the draft across dialog close and reopen", () => {
    const props = callbacks();
    const view = render(<DesignSystemSetup open {...props} />);
    references();
    expect(
      screen.getByRole("dialog").getAttribute("aria-labelledby"),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Add references" }),
    ).toBeTruthy();
    expect(screen.getByRole("dialog").className).toContain("100vh");
    addUrl("Website", "https://example.com/brand");
    view.rerender(<DesignSystemSetup open={false} {...props} />);
    view.rerender(<DesignSystemSetup open {...props} />);
    expect(screen.getByText("https://example.com/brand")).toBeTruthy();
    click("Back");
    expect(
      screen.getByRole("heading", { name: "Create design system" }),
    ).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value,
    ).toBe("Acme");
  });

  it("uses an inline Add to system collector without nesting a dialog", async () => {
    const onAddSources = vi
      .fn()
      .mockRejectedValueOnce(new Error("Revision changed"))
      .mockResolvedValue(undefined);
    render(
      <DesignSystemSetup
        open
        inline
        addingToSystemId="existing-system"
        onAddSources={onAddSources}
        {...callbacks()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    addUrl("Website", "https://example.com/brand");
    click("Add to system");
    await screen.findByText("Revision changed");
    expect(screen.getByText("https://example.com/brand")).toBeTruthy();
    click("Add to system");
    await waitFor(() => expect(onAddSources).toHaveBeenCalledTimes(2));
    expect(onAddSources).toHaveBeenCalledWith(
      "existing-system",
      expect.objectContaining({
        sources: [expect.objectContaining({ kind: "website" })],
      }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps existing editing and completion separate from creation", async () => {
    mocks.existing = {
      title: "Existing brand",
      description: "Saved notes",
      customInstructions: "Saved instructions",
      data: JSON.stringify({ notes: "Saved notes" }),
    };
    const onComplete = vi.fn();
    render(
      <DesignSystemSetup
        open
        editingId="existing"
        onClose={vi.fn()}
        onComplete={onComplete}
      />,
    );
    expect(screen.queryByRole("radio", { name: "Start fresh" })).toBeNull();
    input("Company / Brand", "Renamed brand");
    click("Save Changes");
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      id: "existing",
      title: "Renamed brand",
      description: "Saved notes",
      customInstructions: "Saved instructions",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
