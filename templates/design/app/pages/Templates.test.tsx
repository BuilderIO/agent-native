// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Templates from "./Templates";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  promptProps: null as Record<string, any> | null,
  queryClient: { invalidateQueries: vi.fn() },
  templates: [
    {
      id: "starter-target",
      title: "Target starter",
      description: "Deep-linked starter",
      category: "landing-page",
      lockedLayerCount: 0,
      visibility: "public",
      isOwner: false,
      source: "starter",
      previewHtml: "<main>Preview</main>",
    },
  ],
}));

vi.mock("@agent-native/core/client", () => ({
  ShareButton: () => null,
  useActionQuery: () => ({
    data: {
      count: 1,
      starterCount: 1,
      savedCount: 0,
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
  useSearchParams: () => [new URLSearchParams("templateId=starter-target")],
}));

vi.mock("@/components/templates/TemplatePreview", () => ({
  TemplatePreview: () => <div data-template-preview />,
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

    const card = container.querySelector("#design-template-starter-target");
    expect(card?.getAttribute("aria-current")).toBe("true");
    expect(mocks.promptProps?.open).toBe(true);
    expect(mocks.promptProps?.title).toBe("Target starter");
  });
});
