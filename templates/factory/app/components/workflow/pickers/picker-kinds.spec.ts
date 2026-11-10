import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", () => ({
  isAgentConnectionRequiredError: () => false,
}));
vi.mock("../../../../server/lib/provider-api.js", () => ({
  executeProviderApiRequest: vi.fn(),
}));

import { findOptionLister } from "../../../../server/workflow-host/option-listers/registry.js";
import { WORKFLOW_CATALOG } from "../workflow-catalog";
import {
  mappedOperationFields,
  pickerForInboxPoller,
  pickerForOperationField,
} from "./picker-kinds";

describe("picker kinds", () => {
  it("names a field the catalog still has, on an operation that still exists", () => {
    for (const { operationId, fieldName } of mappedOperationFields()) {
      const def = WORKFLOW_CATALOG.get(operationId);
      expect(def, `${operationId} is not in the catalog`).toBeDefined();
      expect(
        def?.fields.some((field) => field.name === fieldName),
        `${operationId} has no field ${fieldName}`,
      ).toBe(true);
    }
  });

  it("points every kind at a lister the server has, and a parent at one it has too", () => {
    const kinds = [
      pickerForInboxPoller("slack"),
      pickerForInboxPoller("github"),
      pickerForInboxPoller("sentry"),
      ...mappedOperationFields().map(({ operationId, fieldName }) =>
        pickerForOperationField(operationId, fieldName),
      ),
    ];
    for (const kind of kinds) {
      expect(kind).toBeDefined();
      const lister = findOptionLister(kind!.provider, kind!.resource);
      expect(lister, `${kind!.provider}/${kind!.resource}`).toBeDefined();
      expect(lister?.parentResource).toBe(kind!.parentResource);
    }
  });

  it("gives a Sentry source an organization step and leaves other fields without a picker", () => {
    expect(pickerForInboxPoller("sentry").parentResource).toBe("organizations");
    expect(
      pickerForOperationField("builder.start", "projectId"),
    ).toBeUndefined();
    expect(
      pickerForOperationField("slack.postMessage", "text"),
    ).toBeUndefined();
  });
});
