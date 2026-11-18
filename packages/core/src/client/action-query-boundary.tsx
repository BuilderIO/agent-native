import type { ReactNode } from "react";

import { useT } from "./i18n.js";
import type { ActionReadState } from "./use-action.js";

/** Keeps a failed initial read or refetch separate from a successful empty result. */
export function ActionQueryBoundary<T>({
  query,
  pending = null,
  children,
}: {
  query: { readState: ActionReadState<T>; isFetching: boolean };
  pending?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const state = query.readState;
  if (state.status === "pending") return pending;
  if (state.status === "failed")
    return (
      <>
        {state.data === undefined ? null : children(state.data)}
        <ActionQueryFailure retry={state.retry} pending={query.isFetching} />
      </>
    );
  return children(state.data);
}

export function ActionQueryFailure({
  retry,
  pending = false,
  message,
}: {
  retry: () => Promise<unknown>;
  pending?: boolean;
  message?: string;
}) {
  const t = useT();
  return (
    <div role="alert">
      <p>{message ?? t("actionErrors.loadFailed")}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          void retry();
        }}
      >
        {t("actionErrors.retry")}
      </button>
    </div>
  );
}
