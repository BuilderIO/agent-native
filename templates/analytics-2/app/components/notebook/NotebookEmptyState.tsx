import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconDatabase,
  IconFolder,
  IconSearch,
  IconSparkles,
  IconTable,
  IconUpload,
} from "@tabler/icons-react";
import { useRef, useState } from "react";

import type { NotebookConnection, NotebookEmptyState } from "./types";

export function NotebookEmptyState({
  canBrowseData = true,
  connections,
  emptyState,
}: {
  canBrowseData?: boolean;
  connections: readonly NotebookConnection[];
  emptyState: NotebookEmptyState | undefined;
}) {
  const t = useT();
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const defaultConnection = connections.find(
    (connection) => connection.isDefault,
  );
  const connectionName =
    emptyState?.connectionName ??
    defaultConnection?.name ??
    connections[0]?.name ??
    "No data connection";
  const datasets = emptyState?.recentDatasets ?? [];
  const favoriteDatasets = emptyState?.favoriteDatasets ?? [];
  const ask = emptyState?.onAskDataQuestion;
  // Only an action this build can run is offered. A chip with no handler used
  // to render disabled, which is a control that does nothing (row 585: the CSV
  // upload had no handler at all); the chip is pulled instead of shipped dead.
  const moreActions = [
    {
      label: "Browse all data",
      icon: <IconFolder size={14} aria-hidden="true" />,
      onClick: canBrowseData ? emptyState?.onBrowseAllData : undefined,
    },
    {
      label: "Search for data",
      icon: <IconSearch size={14} aria-hidden="true" />,
      onClick: canBrowseData ? emptyState?.onSearchData : undefined,
    },
    {
      label: "Upload a CSV",
      icon: <IconUpload size={14} aria-hidden="true" />,
      onClick: emptyState?.onUploadCsv,
    },
  ].filter((action) => action.onClick != null);

  return (
    <div className="nb-empty-project">
      {error != null && <p role="alert">{error}</p>}

      <div className="nb-empty-content">
        <form
          className="nb-empty-prompt"
          aria-busy={sending}
          onSubmit={(event) => {
            event.preventDefault();
            if (ask == null || question.trim() === "" || sendingRef.current)
              return;
            sendingRef.current = true;
            setSending(true);
            const submitted = question.trim();
            void Promise.resolve()
              .then(() => ask(submitted))
              .then(() => {
                setQuestion((current) =>
                  current.trim() === submitted ? "" : current,
                );
                setError(null);
              })
              .catch((sendError: unknown) => {
                setError(
                  actionErrorMessage(sendError) ??
                    (sendError instanceof Error
                      ? sendError.message
                      : t("notebook.sendFailed")),
                );
              })
              .finally(() => {
                sendingRef.current = false;
                setSending(false);
              });
          }}
        >
          {sending ? (
            <span className="nb-spinner" aria-hidden="true" />
          ) : (
            <IconSparkles size={16} aria-hidden="true" />
          )}
          <input
            value={question}
            placeholder="What would you like to know?"
            aria-label="What would you like to know?"
            disabled={ask == null}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button
            type="button"
            className="nb-empty-connection"
            disabled={emptyState?.onSelectConnection == null}
            onClick={() => void emptyState?.onSelectConnection?.()}
          >
            <IconDatabase size={12} aria-hidden="true" />
            {connectionName}
          </button>
        </form>

        <div className="nb-empty-lists">
          <section className="nb-empty-list" aria-label="Recently used">
            <h2>Recently Used</h2>
            {datasets.length > 0 ? (
              datasets.map((dataset) => (
                <button
                  key={dataset.id}
                  type="button"
                  className="nb-empty-list-item"
                  disabled={emptyState?.onOpenDataset == null}
                  onClick={() => void emptyState?.onOpenDataset?.(dataset.id)}
                >
                  <IconTable size={13} aria-hidden="true" />
                  {dataset.name}
                </button>
              ))
            ) : (
              <p className="nb-empty-list-empty">No recently used tables</p>
            )}
          </section>
          <section className="nb-empty-list" aria-label="Favorites">
            <h2>Favorites</h2>
            {favoriteDatasets.length > 0 ? (
              favoriteDatasets.map((dataset) => (
                <button
                  key={dataset.id}
                  type="button"
                  className="nb-empty-list-item"
                  disabled={emptyState?.onOpenDataset == null}
                  onClick={() => void emptyState?.onOpenDataset?.(dataset.id)}
                >
                  <IconTable size={13} aria-hidden="true" />
                  {dataset.name}
                </button>
              ))
            ) : (
              <p className="nb-empty-list-empty">No favorited data</p>
            )}
          </section>
          {moreActions.length > 0 ? (
            <section
              className="nb-empty-list"
              aria-label={t("notebook.moreDataActions")}
            >
              <h2>MORE</h2>
              {moreActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="nb-empty-list-item"
                  onClick={() => void action.onClick?.()}
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
