// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FigmaAttachDialog,
  type FigmaLinkReference,
  type FigmaLinkTree,
} from "./FigmaAttachDialog";

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/navigation", () => ({
  buildSettingsRoute: () => "/settings",
}));
vi.mock("react-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/lib/figma-attachment", () => ({
  MAX_FIG_REFERENCE_FILE_BYTES: 50 * 1024 * 1024,
}));

const FILE = "https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/Campaigns";
const frame = (id: string, page: string, name: string) => ({
  id,
  title: `${page} / ${name}`,
  url: `${FILE}?node-id=${id}`,
});
const launch = {
  id: "1:1",
  name: "Launch",
  url: `${FILE}?node-id=1-1`,
  frames: [frame("1:2", "Launch", "OG"), frame("1:3", "Launch", "Promo")],
};
const archive = {
  id: "2:1",
  name: "Archive",
  url: `${FILE}?node-id=2-1`,
  frames: [frame("2:2", "Archive", "Old")],
};

let root: Root;
let container: HTMLDivElement;
let attached: FigmaLinkReference[][];
let attachFile: ReturnType<typeof vi.fn<(file: File) => void>>;

function render(tree: FigmaLinkTree) {
  attached = [];
  attachFile = vi.fn<(file: File) => void>();
  act(() =>
    root.render(
      <FigmaAttachDialog
        open
        onOpenChange={() => {}}
        figmaConnected
        loadLink={async () => tree}
        loadPage={async () => []}
        onAttachLinks={(references) => attached.push(references)}
        onAttachFile={attachFile}
      />,
    ),
  );
}

async function typeLink(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="url"]');
  if (!input) throw new Error("no link input");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
}

const checkbox = (label: string) => {
  const target = [...document.querySelectorAll("label")].find(
    (element) => element.textContent === label,
  );
  const box = target && document.getElementById(target.htmlFor);
  if (!box) throw new Error(`no checkbox for ${label}`);
  return box;
};
const click = (element: Element) => act(() => (element as HTMLElement).click());
const addButton = () => {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === "homeContext.figmaAddToPrompt",
  );
  if (!button) throw new Error("no add button");
  return button;
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("FigmaAttachDialog link picker", () => {
  it("adds several whole pages and single frames in one go", async () => {
    render({
      pages: [launch, archive],
      preselected: [],
      preselectedPages: [],
      expandedPages: [],
    });
    await typeLink(FILE);

    await click(checkbox("Launch"));
    expect(checkbox("Launch").getAttribute("aria-checked")).toBe("true");
    // Archive is collapsed; open it and pick its frame on its own.
    const archiveTrigger = [
      ...document.querySelectorAll(
        '[aria-label="homeContext.figmaShowFrames"]',
      ),
    ].find((_, index) => index === 1);
    if (!archiveTrigger) throw new Error("no archive trigger");
    await click(archiveTrigger);
    await click(checkbox("Old"));
    await click(addButton());

    expect(attached).toEqual([
      [
        { id: "1:1", title: "Launch", url: launch.url },
        frame("2:2", "Archive", "Old"),
      ],
    ]);
  });

  it("shows a partly selected page as mixed and adds only its checked frames", async () => {
    render({
      pages: [launch],
      preselected: ["1:2", "1:3"],
      preselectedPages: [],
      expandedPages: [],
    });
    await typeLink(`${FILE}?node-id=1-1`);

    expect(checkbox("Launch").getAttribute("aria-checked")).toBe("true");
    await click(checkbox("Promo"));
    expect(checkbox("Launch").getAttribute("aria-checked")).toBe("mixed");
    await click(addButton());

    expect(attached).toEqual([[frame("1:2", "Launch", "OG")]]);
  });

  it("keeps the dialog open with the reason when the prompt refuses the selection", async () => {
    render({
      pages: [launch],
      preselected: ["1:2"],
      preselectedPages: [],
      expandedPages: [],
    });
    act(() =>
      root.render(
        <FigmaAttachDialog
          open
          onOpenChange={() => {}}
          figmaConnected
          loadLink={async () => ({
            pages: [launch],
            preselected: ["1:2"],
            preselectedPages: [],
            expandedPages: [],
          })}
          loadPage={async () => []}
          onAttachLinks={() => {
            throw new Error("Choose up to 20 references.");
          }}
          onAttachFile={() => {}}
        />,
      ),
    );
    await typeLink(FILE);
    await click(addButton());

    expect(document.body.textContent).toContain("Choose up to 20 references.");
    expect(addButton()).toBeTruthy();
  });

  it("points a file too large to read in the browser to a link instead", async () => {
    render({
      pages: [],
      preselected: [],
      preselectedPages: [],
      expandedPages: [],
    });
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    const huge = new File(["x"], "Campaigns.fig");
    Object.defineProperty(huge, "size", { value: 693 * 1024 * 1024 });
    await act(async () => {
      Object.defineProperty(input, "files", {
        value: [huge],
        configurable: true,
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.body.textContent).toContain(
      "homeContext.figmaFileTooLarge",
    );
    expect(addButton().disabled).toBe(true);
    expect(attachFile).not.toHaveBeenCalled();
  });
});
