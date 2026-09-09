import { useActionQuery } from "@agent-native/core/client/hooks";
import type { ListContentTrashResponse } from "@shared/content-trash";

export type ContentTrashFilters = {
  query?: string;
  kind?: "page" | "database";
  spaceId?: string;
  parentId?: string;
  groupId?: string;
  actor?: string;
  cursor?: string;
};

export function useContentTrash(filters: ContentTrashFilters) {
  return useActionQuery<ListContentTrashResponse>("list-content-trash", {
    ...filters,
    limit: 50,
  });
}
