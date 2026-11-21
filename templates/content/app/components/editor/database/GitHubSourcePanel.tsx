import type { ContentDatabaseSource } from "@shared/api";
import { normalizeGitHubFolderPath } from "@shared/github-source";

import { Button } from "@/components/ui/button";
import { useGitHubConnection } from "@/hooks/use-github-folder";
import { openGitHubLinkDialog } from "@/lib/github-link-dialog";

import {
  githubAvailability,
  githubBlockedExplanation,
  githubOffersNewCollection,
  githubRowDescription,
  type GitHubAvailability,
  type GitHubCollectionPlace,
} from "./github-availability";
import {
  GitHubProblemActions,
  githubSourceCondition,
  githubStoppedText,
  githubSyncProgress,
  useSyncGitHubNow,
} from "./GitHubSourceStatusLine";
import {
  SourcePanel,
  SourcePanelActions,
  SourcePanelEditing,
  SourcePanelMore,
  SourcePanelOpenLink,
  SourcePanelStatus,
  SourcePanelUnlink,
} from "./SourcePanel";
import {
  SentenceWithName,
  SourceFacts,
  SourceSyncNowButton,
  useNow,
} from "./SourceStatusLine";
import { dbText } from "./text";

function openLinkDialog(
  place: GitHubCollectionPlace,
  returnFocusTo: HTMLElement | null,
) {
  openGitHubLinkDialog({
    target: {
      kind: "collection",
      databaseId: place.databaseId,
      documentId: place.documentId,
      spaceId: place.spaceId,
      parentId: place.parentId,
    },
    returnFocusTo,
  });
}

function openNewCollectionDialog(
  place: GitHubCollectionPlace,
  returnFocusTo: HTMLElement | null,
) {
  if (!place.spaceId) return;
  openGitHubLinkDialog({
    target: { kind: "new", spaceId: place.spaceId, parentId: place.parentId },
    returnFocusTo,
  });
}

/**
 * The GitHub row in a collection's Sources: whether a folder can be linked
 * here, said on the row itself before any typing. A row that can link opens
 * the dialog; the rest open the GitHub step, which explains and offers a fix.
 */
export function useGitHubSourcesRow(
  place: GitHubCollectionPlace,
  sources: ContentDatabaseSource[],
  onOpenStep: () => void,
) {
  const now = useNow();
  // Only asked when the collection could link, so readers and full
  // collections never wait on GitHub.
  const collectionAllows =
    githubAvailability(place, sources, true).kind === "available";
  const connection = useGitHubConnection(collectionAllows);
  const availability = githubAvailability(
    place,
    sources,
    connection.data?.connected,
  );
  return {
    availability,
    description: githubRowDescription(availability, now),
    // Grayed out when this collection can't take a folder, but still
    // reachable for the reason and, where there is one, the fix.
    muted: availability.kind === "blocked",
    open: (button: HTMLElement | null) => {
      if (
        availability.kind === "available" ||
        availability.kind === "connect"
      ) {
        openLinkDialog(place, button);
      } else {
        onOpenStep();
      }
    },
  };
}

function LinkedGitHubFolder({
  source,
  place,
  onUnlinked,
}: {
  source: ContentDatabaseSource;
  place: GitHubCollectionPlace;
  onUnlinked: () => void;
}) {
  const now = useNow();
  const sync = useSyncGitHubNow(source);
  const status = source.metadata.github;
  if (!status) return null;
  const folder = normalizeGitHubFolderPath(status.path);
  const repo = `${status.owner}/${status.repo}`;
  const { problem, stops, syncing, paused, notes } =
    githubSourceCondition(status);
  return (
    <SourcePanel provider="github">
      <SentenceWithName
        name={folder || repo}
        sentence={(mark) =>
          folder
            ? dbText("sourcePanelFromGitHubFolder", { folder: mark, repo })
            : dbText("sourcePanelFromGitHubRepo", { repo: mark })
        }
      />
      <SourcePanelStatus
        checkedAt={status.checkedAt ?? status.syncedAt}
        now={now}
        upToDate={!paused && !syncing}
        problem={
          problem && stops
            ? {
                text: githubStoppedText(problem.code, status, now),
                actions: (
                  <GitHubProblemActions
                    status={status}
                    code={problem.code}
                    canEdit={place.canEdit}
                    size="sm"
                  />
                ),
              }
            : null
        }
        progress={githubSyncProgress(status)}
        notes={notes}
      />
      <SourcePanelEditing>{dbText("sourceEditingGitHub")}</SourcePanelEditing>
      <SourcePanelActions>
        <SourceSyncNowButton
          size="sm"
          pending={sync.pending}
          onClick={sync.run}
        />
        <SourcePanelOpenLink
          href={status.folderUrl}
          label={dbText("githubOpenFolder")}
        />
      </SourcePanelActions>
      <SourcePanelMore>
        <SourceFacts
          rows={[{ label: dbText("githubDetailBranch"), value: status.branch }]}
        />
      </SourcePanelMore>
      {place.canEdit ? (
        <SourcePanelUnlink
          note={dbText("sourceUnlinkKeepsPages")}
          provider="github"
          documentId={place.documentId}
          sourceId={source.id}
          pageCount={place.pageCount}
          disabled={sync.pending}
          onUnlinked={onUnlinked}
        />
      ) : null}
    </SourcePanel>
  );
}

/**
 * The GitHub step of a collection's Sources: the linked folder's details
 * and Unlink, or why a folder can't be linked here and what to do instead.
 */
export function GitHubSourcePanel({
  place,
  sources,
  onUnlinked,
}: {
  place: GitHubCollectionPlace;
  sources: ContentDatabaseSource[];
  onUnlinked: () => void;
}) {
  const availability: GitHubAvailability = githubAvailability(
    place,
    sources,
    undefined,
  );
  if (availability.kind === "linked") {
    return (
      <LinkedGitHubFolder
        source={availability.source}
        place={place}
        onUnlinked={onUnlinked}
      />
    );
  }
  if (availability.kind === "blocked") {
    return (
      <div className="grid min-w-0 gap-3" data-github-source-panel="blocked">
        <p className="break-words text-sm">
          {githubBlockedExplanation(
            availability.reason,
            place,
            availability.sourceName,
          )}
        </p>
        {githubOffersNewCollection(availability, place) ? (
          <Button
            type="button"
            size="sm"
            className="justify-self-start"
            onClick={(event) =>
              openNewCollectionDialog(place, event.currentTarget)
            }
          >
            {dbText("githubNewCollectionInstead")}
          </Button>
        ) : null}
      </div>
    );
  }
  // It became linkable since the row was opened, like after a page moved out.
  return (
    <div className="grid min-w-0 gap-3" data-github-source-panel="available">
      <p className="break-words text-sm">{dbText("githubLinkDescription")}</p>
      <Button
        type="button"
        size="sm"
        className="justify-self-start"
        onClick={(event) => openLinkDialog(place, event.currentTarget)}
      >
        {dbText("githubLinkTitle")}
      </Button>
    </div>
  );
}
