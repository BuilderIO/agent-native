import { IconDatabase, IconLock } from "@tabler/icons-react";
import type { ReactNode } from "react";

export function DataPageAdapterFrame({ children }: { children: ReactNode }) {
  return (
    <div className="data-page">
      <header className="data-page-title">
        <span className="data-page-title-icon" aria-hidden="true">
          <IconDatabase size={18} />
        </span>
        <h1>Data browser</h1>
      </header>
      <div className="data-page-tabs" role="tablist" aria-label="Data browser">
        <button
          type="button"
          role="tab"
          id="data-page-tab-all"
          aria-selected="true"
          aria-controls="data-page-panel-all"
          className="data-page-tab is-selected"
        >
          <IconDatabase size={14} aria-hidden="true" />
          <span>Warehouse</span>
        </button>
      </div>
      <div
        className="data-page-panel"
        role="tabpanel"
        id="data-page-panel-all"
        aria-labelledby="data-page-tab-all"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

export function DataPageAdapterNoAccess() {
  return (
    <div className="data-page-no-data" role="alert">
      <span className="data-page-empty-art" aria-hidden="true">
        <IconLock size={52} />
      </span>
      <h2>Data browser</h2>
      <p>You do not have permissions to access workspace data connections.</p>
    </div>
  );
}

export function DataPageAdapterLoading({ label }: { label: string }) {
  return <div role="status" aria-label={label} className="data-page-spinner" />;
}

export function DataPageAdapterFailure({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string | undefined;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="data-page-no-data">
      <h2>{title}</h2>
      {detail ? <p>{detail}</p> : null}
      <button type="button" className="data-page-link" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
