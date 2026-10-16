import { expectTypeOf, it } from "vitest";

import type {
  ChatThreadAccessBasis,
  ChatThreadListRow,
  ChatThreadSummary,
  listThreads,
} from "../server/index.js";
import type { searchThreads } from "./store.js";

it("accepts legacy summary producers without ownership metadata", () => {
  const legacy: ChatThreadSummary = {
    id: "legacy",
    title: "Legacy chat",
    preview: "",
    messageCount: 1,
    createdAt: 1,
    updatedAt: 1,
    scope: null,
    pinnedAt: null,
    archivedAt: null,
    source: null,
    orgId: null,
    visibility: "private",
  };
  expectTypeOf(legacy.ownerEmail).toEqualTypeOf<string | undefined>();
  expectTypeOf(legacy.accessBasis).toEqualTypeOf<
    ChatThreadAccessBasis | undefined
  >();
});

it("requires ownership metadata in the exported list and search results", () => {
  expectTypeOf<Awaited<ReturnType<typeof listThreads>>>().toEqualTypeOf<
    ChatThreadListRow[]
  >();
  expectTypeOf<Awaited<ReturnType<typeof searchThreads>>>().toEqualTypeOf<
    ChatThreadListRow[]
  >();
  expectTypeOf<ChatThreadListRow["ownerEmail"]>().toEqualTypeOf<string>();
  expectTypeOf<
    ChatThreadListRow["accessBasis"]
  >().toEqualTypeOf<ChatThreadAccessBasis>();
});
