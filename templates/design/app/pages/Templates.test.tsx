// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Templates from "./Templates";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setSearchParams: vi.fn(),
  promptProps: null as Record<string, any> | null,
  queryClient: { invalidateQueries: vi.fn() },
  templates: [
    {
      id: "saved-template",
      title: "Saved template",
      description: "Owned reusable template",
      category: "social",
      lockedLayerCount: 1,
      visibility: "private",
      isOwner: true,
      isBuiltIn: false,
      source: "saved",
      previewHtml: "<main>Saved preview</main>",
    },
    {
      id: "built-in-target",
      title: "Built-in target",
      description: "Deep-linked built-in",
      category: "landing-page",
      lockedLayerCount: 0,
      visibility: "public",
      isOwner: false,
      isBuiltIn: true,
      source: "starter",
      previewHtml: "<main>Preview</main>",
    },
  ],
}));

vi.mock("@agent-native/core/client", () => ({
  ShareButton: () => null,
  useActionQuery: () => ({
    data: {
      count: 2,
      starterCount: 1,
      savedCount: 1,
      templates: mocks.templates,
    },
    isLoading: false,
  }),
  useActionMutation: () => ({
    mutateAsync: vi.fn(),
  }),
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetHeaderActions: () => {},
  useSetPageTitle: () => {},
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [
    new URLSearchParams("templateId=built-in-target"),
    mocks.setSearchParams,
  ],
}));

vi.mock("@/components/templates/TemplatePreview", () => ({
  TemplatePreview: ({ title }: { title: string }) => (
    <div data-template-preview={title} />
  ),
}));

vi.mock("@/hooks/use-design-systems", () => ({
  useDesignSystems: () => ({
    designSystems: [],
    defaultSystem: null,
    isLoading: false,
  }),
}));

vi.mock("@/components/editor/PromptDialog", () => ({
  default: (props: Record<string, any>) => {
    mocks.promptProps = props;
    return null;
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.promptProps = null;
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Templates deep links", () => {
  it("highlights and opens the templateId query target", async () => {
    await act(async () => {
      root.render(<Templates />);
    });

    const card = container.querySelector("#design-template-built-in-target");
    expect(card?.getAttribute("aria-current")).toBe("true");
    expect(mocks.promptProps?.open).toBe(true);
    expect(mocks.promptProps?.title).toBe("Built-in target");
  });

  it("renders user templates before built-ins with real previews and a built-in badge", async () => {
    await act(async () => {
      root.render(<Templates />);
    });

    const headings = Array.from(container.querySelectorAll("h2")).map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual([
      "templatesPage.yourTemplates",
      "templatesPage.builtInTemplates",
    ]);
    const cards = Array.from(container.querySelectorAll("article"));
    expect(cards[0]?.id).toBe("design-template-saved-template");
    expect(cards[1]?.id).toBe("design-template-built-in-target");
    expect(
      cards[1]?.querySelector('[data-template-preview="Built-in target"]'),
    ).toBeTruthy();
    expect(cards[1]?.textContent).toContain("templatesPage.builtIn");
  });
});
