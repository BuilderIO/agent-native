import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@agent-native/toolkit/ui/empty";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { IconNotebook } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { useWorkspaceData } from "./WorkspaceDataContext";

import "@/components/projects/projects.css";

const PAGE_SIZE = 50;
type Cursor = { updatedAt: string; id: string };
type LibraryPageData = {
  apps: Array<{ id: string; title: string }>;
  nextCursor: Cursor | null;
};

function LibrarySlice({
  index,
  count,
  cursor,
  seen,
  email,
  orgId,
  onMore,
  onEnd,
}: {
  index: number;
  count: number;
  cursor: Cursor | null;
  seen: ReadonlySet<string>;
  email: string;
  orgId: string;
  onMore: (index: number) => void;
  onEnd: (index: number) => void;
}) {
  const t = useT();
  const query = useActionQuery<LibraryPageData>(
    "list-library-apps",
    {
      limit: PAGE_SIZE,
      ...(cursor
        ? { afterUpdatedAt: cursor.updatedAt, afterId: cursor.id }
        : {}),
    },
    { queryKeyScope: [email, orgId] },
  );
  const sentinel = useRef<HTMLDivElement>(null);
  const nextCursor = query.data?.nextCursor;
  useEffect(() => {
    if (query.data && !query.data.nextCursor) onEnd(index);
  }, [query.data, index, onEnd]);
  useEffect(() => {
    if (index !== count - 1 || !nextCursor || query.isFetching) return;
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onMore(index);
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [index, count, nextCursor, query.isFetching, onMore]);
  if (query.isPending)
    return (
      <div aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
      </div>
    );
  if (query.isError)
    return (
      <div role="alert">
        <p>{t("analytics.catalog.errorTitle")}</p>
        <button type="button" onClick={() => void query.refetch()}>
          {t("analytics.catalog.retry")}
        </button>
      </div>
    );
  const apps = query.data.apps.filter((app) => !seen.has(app.id));
  const nextSeen = new Set([...seen, ...apps.map((app) => app.id)]);
  if (index === 0 && !apps.length && !nextCursor)
    return (
      <Empty className="mx-7 mb-7">
        <EmptyHeader>
          <EmptyMedia className="size-16 rounded-full border border-border text-muted-foreground">
            <IconNotebook aria-hidden="true" size={30} />
          </EmptyMedia>
          <h2 className="font-medium">
            {t("analytics.catalog.libraryEmptyTitle")}
          </h2>
          <EmptyDescription>
            {t("analytics.catalog.libraryEmptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <>
      <div className="ws-projects-table-scroll">
        <table className="ws-projects-table">
          <tbody>
            {apps.map((app) => (
              <tr key={app.id}>
                <td>
                  <Link to={`/app/${encodeURIComponent(app.id)}/latest`}>
                    {app.title}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextCursor && index + 1 < count ? (
        <LibrarySlice
          key={JSON.stringify(nextCursor)}
          index={index + 1}
          count={count}
          cursor={nextCursor}
          seen={nextSeen}
          email={email}
          orgId={orgId}
          onMore={onMore}
          onEnd={onEnd}
        />
      ) : (
        nextCursor && (
          <>
            <div ref={sentinel} />
            {typeof IntersectionObserver === "undefined" && (
              <button type="button" onClick={() => onMore(index)}>
                {t("analytics.lists.more")}
              </button>
            )}
          </>
        )
      )}
    </>
  );
}
function LibrarySlices({ email, orgId }: { email: string; orgId: string }) {
  const [count, setCount] = useState(1);
  const onMore = useCallback(
    (index: number) =>
      setCount((count) => (count === index + 1 ? count + 1 : count)),
    [],
  );
  const onEnd = useCallback(
    (index: number) => setCount((count) => Math.min(count, index + 1)),
    [],
  );
  return (
    <LibrarySlice
      index={0}
      count={count}
      cursor={null}
      seen={new Set()}
      email={email}
      orgId={orgId}
      onMore={onMore}
      onEnd={onEnd}
    />
  );
}
export function LibraryPage() {
  const t = useT();
  const shell = useWorkspaceData()?.shell;
  const orgId = shell?.workspace.id;
  const email = shell?.user.email;
  return (
    <div className="ws-projects" data-workspace-surface="library">
      <header className="ws-projects-header">
        <h1 className="ws-projects-title">{t("analytics.catalog.library")}</h1>
      </header>
      {email && orgId ? (
        <LibrarySlices
          key={JSON.stringify([email, orgId])}
          email={email}
          orgId={orgId}
        />
      ) : (
        <div aria-busy="true">
          <Skeleton className="h-10 w-full" />
        </div>
      )}
    </div>
  );
}
