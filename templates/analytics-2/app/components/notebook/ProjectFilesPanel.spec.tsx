// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { ToolRail } from "./ToolRail";

const hooks = vi.hoisted(() => ({
  upload: vi.fn(),
  refetch: vi.fn(),
  download: vi.fn(),
  files: [] as Array<{
    id: string;
    filename: string;
    mimeType: string;
    bytes: number;
    createdAt: string;
  }>,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: { files: hooks.files },
    isPending: false,
    refetch: hooks.refetch,
  }),
  useActionMutation: () => ({ mutateAsync: hooks.upload, isPending: false }),
  callAction: hooks.download,
}));
afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  hooks.files = [];
});

it("offers a Files rail control which opens its backed panel", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const selected = vi.fn();
  try {
    await act(async () => root.render(<ToolRail onSelect={selected} />));
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Files"]',
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(selected).toHaveBeenCalledWith("files");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("uploads the selected file bytes to the current project and refreshes its list", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  hooks.upload.mockResolvedValue({ file: { id: "uploaded" } });
  hooks.refetch.mockResolvedValue({});
  try {
    await act(async () =>
      root.render(
        <ProjectFilesPanel projectId="project-owned" onClose={() => {}} />,
      ),
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Upload files"]',
    );
    expect(input).not.toBeNull();
    const file = new File(["file body\n"], "report.txt", {
      type: "text/plain",
    });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(hooks.upload).toHaveBeenCalledWith({
      projectId: "project-owned",
      filename: "report.txt",
      mimeType: "text/plain",
      dataBase64: btoa("file body\n"),
    });
    expect(hooks.refetch).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("refreshes the list when a later file in a batch fails after an earlier one was stored", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  hooks.upload
    .mockResolvedValueOnce({ file: { id: "first" } })
    .mockRejectedValueOnce(new Error("Second upload failed"));
  hooks.refetch.mockResolvedValue({});
  try {
    await act(async () =>
      root.render(
        <ProjectFilesPanel projectId="project-owned" onClose={() => {}} />,
      ),
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Upload files"]',
    );
    Object.defineProperty(input, "files", {
      value: [new File(["a"], "a.txt"), new File(["b"], "b.txt")],
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Second upload failed",
    );
    expect(hooks.refetch).toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("imports a CSV into queryable staged rows", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  hooks.upload.mockResolvedValue({
    dataset: { id: "dataset-1", name: "report", rowCount: 1 },
  });
  try {
    await act(async () =>
      root.render(
        <ProjectFilesPanel projectId="project-owned" onClose={() => {}} />,
      ),
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Import CSV for querying"]',
    );
    const file = new File(["name,amount\nAda,12\n"], "report.csv", {
      type: "text/csv",
    });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(hooks.upload).toHaveBeenCalledWith({
      projectId: "project-owned",
      filename: "report.csv",
      dataBase64: btoa("name,amount\nAda,12\n"),
    });
    expect(container.textContent).toContain(
      "Imported report (1 row). Staged data is ready to query.",
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("keeps downloads available to a reader while hiding upload and delete controls", async () => {
  hooks.files = [
    {
      id: "file-reader",
      filename: "available.txt",
      mimeType: "text/plain",
      bytes: 12,
      createdAt: "2026-01-01T00:00:00Z",
    },
  ];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectFilesPanel
          projectId="project-readable"
          canEdit={false}
          onClose={() => {}}
        />,
      ),
    );
    expect(
      container.querySelector('button[aria-label="Download available.txt"]'),
    ).not.toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(
      container.querySelector('button[aria-label="Delete available.txt"]'),
    ).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

async function mountWithFile() {
  hooks.files = [
    {
      id: "file-1",
      filename: "notes.txt",
      mimeType: "text/plain",
      bytes: 4,
      createdAt: "2026-01-01T00:00:00Z",
    },
  ];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(<ProjectFilesPanel projectId="p" onClose={() => {}} />),
  );
  const open = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Delete notes.txt"]',
  );
  open?.focus();
  await act(async () => open?.click());
  return { container, root, open };
}

function dialogButton(label: string) {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ).find((b) => b.textContent === label);
}

it("returns focus to the Delete control when the dialog is cancelled", async () => {
  const { container, root, open } = await mountWithFile();
  try {
    await act(async () => dialogButton("Cancel")?.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(document.activeElement).toBe(open);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("moves focus to the files panel when the deleted row's control is gone", async () => {
  const { container, root } = await mountWithFile();
  try {
    hooks.upload.mockImplementation(async () => {
      hooks.files = [];
    });
    await act(async () => dialogButton("Delete")?.click());
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    const section = container.querySelector("section");
    expect(document.activeElement).toBe(section);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("keeps focus on the files panel when the file list refetch removes the deleted row asynchronously", async () => {
  const { container, root } = await mountWithFile();
  let finishRefetch: (() => void) | undefined;
  try {
    hooks.upload.mockResolvedValue({ trashed: true });
    hooks.refetch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefetch = () => {
            hooks.files = [];
            resolve();
          };
        }),
    );
    await act(async () => dialogButton("Delete")?.click());
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    const section = container.querySelector("section");
    expect(document.activeElement).toBe(section);

    await act(async () => {
      finishRefetch?.();
      root.render(<ProjectFilesPanel projectId="p" onClose={() => {}} />);
    });
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(
      container.querySelector('button[aria-label="Delete notes.txt"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(section);
    expect(document.activeElement).not.toBe(document.body);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("restores focus to the Delete button when deletion fails and the user cancels", async () => {
  const { container, root, open } = await mountWithFile();
  try {
    hooks.upload.mockRejectedValueOnce(new Error("Delete failed"));
    await act(async () => dialogButton("Delete")?.click());
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => dialogButton("Cancel")?.click());
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(document.activeElement).toBe(open);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
