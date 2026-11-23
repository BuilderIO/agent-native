import { vi } from "vitest";

export interface LabelFixture {
  id: string;
  name: string;
  color: string | null;
}

/** What the mocked data hooks answer with; a test sets it before it mounts. */
export const assetLabels = {
  isAdmin: true,
  statuses: [] as LabelFixture[],
  categories: [] as LabelFixture[],
  callAction: vi.fn(),
  reset() {
    this.isAdmin = true;
    this.statuses = [];
    this.categories = [];
    this.callAction.mockReset();
    this.callAction.mockImplementation(async () => ({}));
  },
};

export const STATUSES: LabelFixture[] = [
  { id: "status-1", name: "Draft", color: "#d64545" },
  { id: "status-2", name: "Certified", color: "#3f9c63" },
  { id: "status-3", name: "No color", color: null },
];

export const CATEGORIES: LabelFixture[] = [
  { id: "category-1", name: "Finance", color: "#3f6fb5" },
  { id: "category-2", name: "Growth", color: "#7b5cc4" },
];

export const assetLabelHooksMock = {
  callAction: (...args: unknown[]) => assetLabels.callAction(...args),
  useActionQuery: (name: string) => {
    if (name === "get-workspace-bootstrap") {
      return { data: { features: { isAdmin: assetLabels.isAdmin } } };
    }
    if (name === "list-data-statuses") {
      return { data: { statuses: assetLabels.statuses } };
    }
    return { data: { categories: assetLabels.categories } };
  },
};

export function labelRoute(view: "asset-statuses" | "asset-categories") {
  return { view } as never;
}
