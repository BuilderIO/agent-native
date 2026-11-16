import { describe, expect, it } from "vitest";

import {
  actionQueryAffectedByChanges,
  actionQueryAffectedByResources,
  type ActionResourceChange,
  type ActionScopedQuery,
} from "./action-query-scope.js";

const actionQuery = (resources: unknown): ActionScopedQuery => ({
  queryKey: ["action", "read"],
  meta: { actionResources: resources },
});

describe("action query resource scope", () => {
  it.each([
    { tags: ["design"], resources: ["design"], affected: true },
    { tags: ["design"], resources: ["design:d1"], affected: true },
    { tags: ["design:d1"], resources: ["design"], affected: true },
    { tags: ["design:d1"], resources: ["design:d1"], affected: true },
    { tags: ["design:d1"], resources: ["design:d2"], affected: false },
    { tags: ["design:d1"], resources: ["design:d1:part"], affected: false },
    { tags: ["design:d1:part"], resources: ["design:d1:part"], affected: true },
    { tags: ["design"], resources: ["designer:d1"], affected: false },
    { tags: ["design"], resources: ["document"], affected: false },
    {
      tags: ["document", "design:d1"],
      resources: ["design:d1"],
      affected: true,
    },
    { tags: [null, "design:d1"], resources: ["design:d1"], affected: true },
    { tags: [null, 42], resources: ["design"], affected: false },
    { tags: ["design"], resources: [], affected: false },
    { tags: [], resources: ["document"], affected: true },
    { tags: undefined, resources: ["document"], affected: true },
    { tags: "design", resources: ["document"], affected: true },
  ])(
    "matches resource tags $tags against $resources: $affected",
    ({ tags, resources, affected }) => {
      expect(
        actionQueryAffectedByResources(actionQuery(tags), new Set(resources)),
      ).toBe(affected);
    },
  );

  it.each<{
    tags: unknown;
    changes: ActionResourceChange[];
    affected: boolean;
  }>([
    {
      tags: ["design"],
      changes: [{ type: "design", id: "d1" }],
      affected: true,
    },
    {
      tags: ["design:d1"],
      changes: [{ type: "design", id: "d1" }],
      affected: true,
    },
    {
      tags: ["design:d2"],
      changes: [{ type: "design", id: "d1" }],
      affected: false,
    },
    {
      tags: ["design:d1:part"],
      changes: [{ type: "design", id: "d1" }],
      affected: false,
    },
    {
      tags: ["design:d1:part"],
      changes: [{ type: "design", id: "d1:part" }],
      affected: true,
    },
    { tags: ["design:d1"], changes: [{ type: "design" }], affected: true },
    {
      tags: ["design:d2"],
      changes: [{ type: "design", id: "" }],
      affected: true,
    },
    { tags: ["design"], changes: [{ type: "design" }], affected: true },
    { tags: ["designer:d1"], changes: [{ type: "design" }], affected: false },
    {
      tags: ["design"],
      changes: [{ type: "document", id: "d1" }],
      affected: false,
    },
    {
      tags: ["design:layer"],
      changes: [{ type: "design:layer", id: "a:b" }],
      affected: true,
    },
    {
      tags: ["design:layer:a:b"],
      changes: [{ type: "design:layer", id: "a:b" }],
      affected: true,
    },
    {
      tags: ["design:layer:a"],
      changes: [{ type: "design:layer", id: "a:b" }],
      affected: false,
    },
    {
      tags: ["design:layer:a:b"],
      changes: [{ type: "design:layer" }],
      affected: true,
    },
    { tags: ["design"], changes: [{ type: "design:layer" }], affected: false },
    {
      tags: ["document", "design:d1"],
      changes: [
        { type: "document", id: "other" },
        { type: "design", id: "d1" },
      ],
      affected: true,
    },
    {
      tags: [null, "design:d1"],
      changes: [{ type: "design", id: "d1" }],
      affected: true,
    },
    { tags: [null, 42], changes: [{ type: "design" }], affected: false },
    { tags: ["design"], changes: [], affected: false },
    { tags: [], changes: [{ type: "document" }], affected: true },
    { tags: undefined, changes: [{ type: "document" }], affected: true },
  ])(
    "matches event changes $changes against $tags: $affected",
    ({ tags, changes, affected }) => {
      expect(actionQueryAffectedByChanges(actionQuery(tags), changes)).toBe(
        affected,
      );
    },
  );

  it.each([
    { queryKey: ["other", "read"], meta: { actionResources: ["design"] } },
    { queryKey: ["other", "read"] },
    { queryKey: [] },
  ])("never matches a non-action query $queryKey", (query) => {
    expect(actionQueryAffectedByResources(query, new Set(["design"]))).toBe(
      false,
    );
    expect(actionQueryAffectedByChanges(query, [{ type: "design" }])).toBe(
      false,
    );
  });
});
