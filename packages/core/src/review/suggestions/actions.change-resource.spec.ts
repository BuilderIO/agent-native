import { describe, expect, it } from "vitest";

import {
  createResourceSuggestion,
  createResourceSuggestionProposal,
  decideResourceSuggestion,
  decideResourceSuggestionProposal,
  updateResourceSuggestion,
} from "./actions.js";
import type { ResourceSuggestion } from "./types.js";

const resource = { resourceType: "document", resourceId: "doc-1" };
const suggestion = { id: "s-1", ...resource } as ResourceSuggestion;

describe("suggestion change events", () => {
  it("name the resource a new suggestion is on", () => {
    expect(
      createResourceSuggestion.changeResource?.(resource as never, {} as never),
    ).toEqual(resource);
    expect(
      createResourceSuggestionProposal.changeResource?.(
        resource as never,
        {} as never,
      ),
    ).toEqual(resource);
  });

  it("name the resource of an amended or decided suggestion from its result", () => {
    expect(
      updateResourceSuggestion.changeResource?.(
        { id: "s-1" } as never,
        suggestion as never,
      ),
    ).toEqual(resource);
    expect(
      decideResourceSuggestion.changeResource?.(
        { id: "s-1" } as never,
        { suggestion } as never,
      ),
    ).toEqual(resource);
    expect(
      decideResourceSuggestionProposal.changeResource?.(
        { proposalId: "p-1" } as never,
        { suggestions: [suggestion] } as never,
      ),
    ).toEqual(resource);
  });

  it("name nothing when a decision returns no suggestion", () => {
    expect(
      decideResourceSuggestion.changeResource?.(
        { id: "s-1" } as never,
        {} as never,
      ),
    ).toBeNull();
    expect(
      decideResourceSuggestionProposal.changeResource?.(
        { proposalId: "p-1" } as never,
        { suggestions: [] } as never,
      ),
    ).toBeNull();
  });

  it("name nothing, without throwing, when a failed call has no result", () => {
    for (const action of [
      updateResourceSuggestion,
      decideResourceSuggestion,
      decideResourceSuggestionProposal,
    ]) {
      expect(
        action.changeResource?.({} as never, undefined as never),
      ).toBeNull();
    }
  });
});
