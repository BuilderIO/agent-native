import { callAction } from "@agent-native/core/client/hooks";
import { ANALYTICS_CHART_TAG } from "@shared/analytics-chart-block";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { DOCUMENT_UPDATE_MUTATION_KEY } from "@/hooks/use-documents";

export const CITATION_SYNC_DELAY_MS = 2_000;

export const LIVE_COPY_CITATION_SYNC_DELAY_MS = 5_000;

const CHART_MARKS = new RegExp(
  `<${ANALYTICS_CHART_TAG}(?:\\s+id="[^"]*")?|\\scapturedAt="[^"]*"`,
  "g",
);

export function analyticsChartSignature(
  content: string | null | undefined,
): string {
  if (!content?.includes(`<${ANALYTICS_CHART_TAG}`)) return "";
  return (content.match(CHART_MARKS) ?? []).join("|");
}

interface PageCharts {
  documentId: string;
  signature: string;
}

function createCitationSyncer() {
  let synced: PageCharts | null = null;
  let pending: (PageCharts & { timer: ReturnType<typeof setTimeout> }) | null =
    null;

  const send = (charts: PageCharts) => {
    const previous = synced;
    synced = charts;
    void callAction("sync-analytics-chart-citations", {
      documentId: charts.documentId,
    }).catch((error: unknown) => {
      console.warn("[content-analytics] Couldn't update Cited in", {
        documentId: charts.documentId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (synced === charts) synced = previous;
    });
  };

  const flush = () => {
    const waiting = pending;
    if (!waiting) return;
    pending = null;
    clearTimeout(waiting.timer);
    send(waiting);
  };

  const schedule = (charts: PageCharts, delayMs: number) => {
    if (pending && pending.documentId !== charts.documentId) flush();
    if (pending) clearTimeout(pending.timer);
    if (delayMs <= 0) {
      pending = null;
      send(charts);
      return;
    }
    const entry = {
      ...charts,
      timer: setTimeout(() => {
        if (pending !== entry) return;
        pending = null;
        send(charts);
      }, delayMs),
    };
    pending = entry;
  };

  const baseline = (documentId: string): string | undefined =>
    pending?.documentId === documentId
      ? pending.signature
      : synced?.documentId === documentId
        ? synced.signature
        : undefined;

  return {
    opened(charts: PageCharts) {
      if (baseline(charts.documentId) !== undefined) return;
      if (charts.signature) schedule(charts, CITATION_SYNC_DELAY_MS);
      else synced = charts;
    },
    saved(charts: PageCharts, delayMs: number) {
      if (charts.signature === baseline(charts.documentId)) return;
      schedule(charts, delayMs);
    },
    flush,
  };
}

const UPDATE_DOCUMENT_KEY_HASH = hashKey(DOCUMENT_UPDATE_MUTATION_KEY);

export function useAnalyticsChartCitationSync({
  documentId,
  enabled,
  openedContent,
  liveCopyContent,
}: {
  documentId: string;
  enabled: boolean;
  openedContent: string | null | undefined;
  liveCopyContent: string | null;
}): void {
  const queryClient = useQueryClient();
  const [syncer] = useState(createCitationSyncer);
  const opened = useRef(openedContent);
  opened.current = openedContent;

  useEffect(() => {
    if (!enabled) return;
    syncer.opened({
      documentId,
      signature: analyticsChartSignature(opened.current),
    });
  }, [documentId, enabled, syncer]);

  useEffect(() => {
    if (!enabled) return;
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      const { mutationKey } = event.mutation.options;
      if (!mutationKey || hashKey(mutationKey) !== UPDATE_DOCUMENT_KEY_HASH) {
        return;
      }
      const variables = event.mutation.state.variables as
        | { id?: unknown; content?: unknown }
        | undefined;
      if (
        variables?.id !== documentId ||
        typeof variables.content !== "string"
      ) {
        return;
      }
      syncer.saved(
        { documentId, signature: analyticsChartSignature(variables.content) },
        CITATION_SYNC_DELAY_MS,
      );
    });
  }, [documentId, enabled, queryClient, syncer]);

  useEffect(() => {
    if (!enabled || liveCopyContent === null) return;
    const timer = setTimeout(
      () =>
        syncer.saved(
          { documentId, signature: analyticsChartSignature(liveCopyContent) },
          0,
        ),
      LIVE_COPY_CITATION_SYNC_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [documentId, enabled, liveCopyContent, syncer]);

  useEffect(() => () => syncer.flush(), [syncer]);
}
