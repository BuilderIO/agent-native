import { subscribeAgentChatComposerSubmit } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import type { ContextPreview } from "@agent-native/core/shared/context-xray";
import {
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";

import { useDocument } from "@/hooks/use-documents";
import { cn } from "@/lib/utils";

import {
  buildAgentContextRows,
  type AgentContextRowKey,
} from "./agent-context-line";

const PREVIEW_STALE_MS = 60_000;

const lineButtonClass =
  "-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 items-center gap-1.5 rounded-[var(--agent-kit-radius-xs,0.25rem)] px-1.5 text-start text-xs leading-4 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function AgentContextLine({ documentId }: { documentId: string }) {
  const t = useT();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const page = useDocument(
    documentId,
    {
      databaseId: search.get("databaseId"),
      databaseDocumentId: search.get("databaseDocumentId"),
    },
    { enabled: false },
  ).data;
  const previewQuery = useActionQuery(
    "context-preview-get",
    { scope: "user" },
    { staleTime: PREVIEW_STALE_MS },
  );
  const preview = previewQuery.data as ContextPreview | undefined;
  const workspaceName = useOrg().data?.orgName;
  const [open, setOpen] = useState(false);
  const [detailKey, setDetailKey] = useState<AgentContextRowKey | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const fold = useCallback(() => {
    setOpen(false);
    setDetailKey(null);
  }, []);

  useEffect(
    () =>
      subscribeAgentChatComposerSubmit((submit) => {
        if (!submit.withdrawn) fold();
      }),
    [fold],
  );
  useEffect(() => fold(), [documentId, fold]);

  const rows = useMemo(
    () =>
      page
        ? buildAgentContextRows(
            {
              title: page.title,
              content: page.content,
              contextPath: page.contextPath,
              spaceDatabaseId: page.databaseMembership?.systemRole
                ? page.databaseMembership.databaseId
                : null,
            },
            preview,
            { t, workspaceName },
          )
        : null,
    [page, preview, t, workspaceName],
  );
  if (!rows) return null;
  const [pageRow] = rows;
  const more = rows.length - 1;

  return (
    <div
      data-agent-context-line=""
      className="min-w-0"
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        fold();
        toggleRef.current?.focus();
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          if (!open) void previewQuery.refetch();
          setOpen(!open);
          setDetailKey(null);
        }}
        className={cn(lineButtonClass, "h-6")}
      >
        {open ? (
          <span className="min-w-0 truncate font-medium text-foreground">
            {t("agentContext.openTitle")}
          </span>
        ) : (
          <>
            <span className="shrink-0 text-muted-foreground">
              {t("agentContext.agentGets")}
            </span>
            <span className="min-w-0 truncate font-medium text-foreground">
              {pageRow.name}
            </span>
            {more > 0 ? (
              <span className="shrink-0 text-muted-foreground">
                {t("agentContext.more", { number: more })}
              </span>
            ) : null}
          </>
        )}
        {open ? (
          <IconChevronDown
            aria-hidden="true"
            className="ms-auto size-3.5 shrink-0 text-muted-foreground"
          />
        ) : (
          <IconChevronUp
            aria-hidden="true"
            className="ms-auto size-3.5 shrink-0 text-muted-foreground"
          />
        )}
      </button>
      {open ? (
        <ul
          id={listId}
          className="-mx-1.5 max-h-[260px] overflow-y-auto overflow-x-hidden px-1.5 pb-0.5"
        >
          {rows.map((row) => {
            const expanded = detailKey === row.key;
            const detailId = `${listId}-${row.key}`;
            return (
              <li key={row.key}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={expanded ? detailId : undefined}
                  onClick={() => setDetailKey(expanded ? null : row.key)}
                  className={cn(lineButtonClass, "h-[26px]")}
                >
                  <span
                    title={row.name}
                    className="max-w-[58%] shrink-0 truncate font-medium text-foreground"
                  >
                    {row.name}
                  </span>
                  <span
                    title={row.meta}
                    className="min-w-0 truncate text-muted-foreground"
                  >
                    {row.meta}
                  </span>
                  <IconChevronRight
                    aria-hidden="true"
                    className={cn(
                      "ms-auto size-3 shrink-0 text-muted-foreground rtl:rotate-180",
                      expanded && "rotate-90 rtl:rotate-90",
                    )}
                  />
                </button>
                {expanded ? (
                  <p
                    id={detailId}
                    className="pb-1.5 text-[11.5px] leading-4 text-muted-foreground"
                  >
                    {row.detail}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
