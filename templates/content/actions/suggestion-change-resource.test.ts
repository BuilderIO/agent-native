import createResourceSuggestion from "@agent-native/core/review/suggestions/actions/create-resource-suggestion";
import createResourceSuggestionProposal from "@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal";
import decideResourceSuggestion from "@agent-native/core/review/suggestions/actions/decide-resource-suggestion";
import decideResourceSuggestionProposal from "@agent-native/core/review/suggestions/actions/decide-resource-suggestion-proposal";
import updateResourceSuggestion from "@agent-native/core/review/suggestions/actions/update-resource-suggestion";
import { describe, expect, it } from "vitest";

import { SUGGESTION_MUTATIONS } from "../app/hooks/content-action-refresh.js";
import suggestDocumentEdit from "./suggest-document-edit.js";

// An open page refreshes its suggestions on these actions' change events. An
// action that names no resource tells only its actor, and that only at the idle
// poll, so a suggested edit took minutes to appear, or never reached a collaborator.
const actions: Record<string, { changeResource?: unknown }> = {
  "create-resource-suggestion": createResourceSuggestion,
  "create-resource-suggestion-proposal": createResourceSuggestionProposal,
  "decide-resource-suggestion": decideResourceSuggestion,
  "decide-resource-suggestion-proposal": decideResourceSuggestionProposal,
  "suggest-document-edit": suggestDocumentEdit,
  "update-resource-suggestion": updateResourceSuggestion,
};

describe("suggestion mutations an open page refreshes on", () => {
  it("are all checked here", () => {
    expect(Object.keys(actions).sort()).toEqual(
      [...SUGGESTION_MUTATIONS].sort(),
    );
  });

  it.each(Object.keys(actions))("%s names the resource it changed", (name) => {
    expect(actions[name]?.changeResource).toBeTypeOf("function");
  });

  it("suggest-document-edit names the page", () => {
    expect(
      suggestDocumentEdit.changeResource?.(
        { id: "doc-1" } as never,
        {} as never,
      ),
    ).toEqual({ resourceType: "document", resourceId: "doc-1" });
  });
});
