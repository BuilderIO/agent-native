import type { Resource } from "@agent-native/core/client/resources/use-resources";
import {
  isSameRecord,
  isSaveConflict,
  rebaseOntoSaved,
  SaveOverlapError,
  saveWithMerge,
  type SavedRecord,
} from "@agent-native/core/save-conflict";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSaveConflictPrompt } from "../save-conflict.js";

const SAVE_DEBOUNCE_MS = 1_000;
const CONTENDED_RETRY_MS = 1_000;

interface ResourceContent {
  content: string;
}

interface ServerContent {
  content: string;
  revision: string | undefined;
  updatedAt: Resource["updatedAt"];
}

export interface ResourceContentSaveAttempt {
  id: string;
  content: string;
  /** The revision this content was edited from, when the read had one. */
  expectedRevision: string | undefined;
}

/**
 * Saves a resource's content only over the revision it was edited from, and
 * throws the typed save conflict (`isSaveConflict`) when someone saved other
 * content since. `useUpdateResource().mutateAsync` does this. It resolves to
 * the resource the content was saved in, which can be another one than it was
 * sent to: the first save of a legacy shared resource copies it into the
 * organization.
 */
export type SaveResourceContent = (
  attempt: ResourceContentSaveAttempt,
) => Promise<Pick<Resource, "id" | "content" | "revision" | "updatedAt">>;

/**
 * The resource editor's content. With `saveContent`, edits save on a debounce
 * against the revision they started from. When another tab or the agent saved
 * other content meanwhile, it asks which version to keep and offers the other
 * back after. Newer content from the server shows when there are no unsaved
 * edits. Without `saveContent`, `onSave` gets each edit and the last save
 * wins.
 */
export function useResourceContentSave({
  resource,
  readOnly,
  saveContent,
  onSave,
}: {
  resource: Resource;
  readOnly?: boolean | undefined;
  saveContent?: SaveResourceContent | undefined;
  onSave?: ((content: string) => void) | undefined;
}) {
  const merging = !!saveContent;
  const [content, setContent] = useState(resource.content);
  const localRef = useRef<ResourceContent>({ content: resource.content });
  const savedRef = useRef<SavedRecord<ResourceContent>>({
    value: { content: resource.content },
    revision: resource.revision ?? null,
  });
  const savedUpdatedAtRef = useRef(resource.updatedAt);
  // Saves go where the last one landed, and the revision they send is that
  // resource's.
  const saveIdRef = useRef(resource.id);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const retryOnFailureRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mergingRef = useRef(merging);
  mergingRef.current = merging;

  const replaceLocal = useCallback((next: string) => {
    localRef.current = { content: next };
    setContent(next);
  }, []);

  // Content someone else saved shows here unless it would replace edits not
  // saved yet; then it waits until they are. A read no newer than the last
  // save is skipped, since it left before that save came back, or is that
  // save. So is a read of this resource once saves go to another one, since
  // what it shows is no longer what they save over.
  const serverRef = useRef<ServerContent>({
    content: resource.content,
    revision: resource.revision,
    updatedAt: resource.updatedAt,
  });
  const deferredRef = useRef(false);
  const resourceId = resource.id;
  const adoptServer = useCallback(
    (next: ServerContent) => {
      deferredRef.current = false;
      if (saveIdRef.current !== resourceId) return;
      if (next.updatedAt <= savedUpdatedAtRef.current) return;
      savedUpdatedAtRef.current = next.updatedAt;
      savedRef.current = {
        value: { content: next.content },
        revision: next.revision ?? null,
      };
      if (localRef.current.content !== next.content) {
        replaceLocal(next.content);
      }
    },
    [replaceLocal, resourceId],
  );

  const flushRef = useRef<() => Promise<void>>(async () => {});

  const schedule = useCallback((delayMs: number) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      void flushRef.current();
    }, delayMs);
  }, []);

  const editContent = useCallback(
    (next: string) => {
      if (readOnly) return;
      replaceLocal(next);
      dirtyRef.current = true;
      schedule(SAVE_DEBOUNCE_MS);
    },
    [readOnly, replaceLocal, schedule],
  );

  const conflict = useSaveConflictPrompt<ResourceContent>({
    record: "resource_content",
    onRestore: (restoreOnto) =>
      editContent(restoreOnto(localRef.current).content),
  });

  flushRef.current = async () => {
    if (!saveContent) {
      dirtyRef.current = false;
      onSave?.(localRef.current.content);
      return;
    }
    if (savingRef.current) {
      // The save that's out takes this edit along if it lands. If it fails,
      // its catch has to, since this edit's timer has already gone.
      retryOnFailureRef.current = true;
      return;
    }
    savingRef.current = true;
    try {
      while (!isSameRecord(savedRef.current.value, localRef.current)) {
        const mine = localRef.current;
        const saved = await saveWithMerge<ResourceContent>({
          base: savedRef.current,
          mine,
          resolveOverlap: conflict.resolveOverlap,
          save: async ({ value, revision }) => {
            let result: Awaited<ReturnType<SaveResourceContent>>;
            try {
              result = await saveContent({
                id: saveIdRef.current,
                content: value.content,
                expectedRevision: revision ?? undefined,
              });
            } catch (error) {
              // A conflict carries what's there now, so a read waiting from
              // before it is older and no longer shows.
              if (isSaveConflict(error)) deferredRef.current = false;
              throw error;
            }
            saveIdRef.current = result.id;
            savedUpdatedAtRef.current = result.updatedAt;
            return {
              value: { content: result.content },
              revision: result.revision ?? null,
            };
          },
        });
        savedRef.current = saved;
        const rebased = rebaseOntoSaved(mine, localRef.current, saved.value);
        if (rebased.content !== localRef.current.content) {
          replaceLocal(rebased.content);
        }
      }
      dirtyRef.current = false;
    } catch (error) {
      // `saveContent` reports other failures, and the edits stay for the next
      // save. Only content too contended to settle in one go tries by itself,
      // or a save with no next one coming: the editor closed, or a newer
      // edit's timer went off while this save was out.
      if (
        isSaveConflict(error) ||
        (retryOnFailureRef.current && !(error instanceof SaveOverlapError))
      ) {
        schedule(CONTENDED_RETRY_MS);
      }
    } finally {
      retryOnFailureRef.current = false;
      savingRef.current = false;
    }
    if (!dirtyRef.current && deferredRef.current) {
      adoptServer(serverRef.current);
    }
  };

  const serverContent = resource.content;
  const serverRevision = resource.revision;
  const serverUpdatedAt = resource.updatedAt;
  useEffect(() => {
    serverRef.current = {
      content: serverContent,
      revision: serverRevision,
      updatedAt: serverUpdatedAt,
    };
    if (!merging) return;
    if (dirtyRef.current || savingRef.current) {
      deferredRef.current = true;
      return;
    }
    adoptServer(serverRef.current);
  }, [adoptServer, merging, serverContent, serverRevision, serverUpdatedAt]);

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      if (!mergingRef.current || !dirtyRef.current) return;
      retryOnFailureRef.current = true;
      void flushRef.current();
    },
    [],
  );

  return { content, editContent, conflictPrompt: conflict.prompt };
}
