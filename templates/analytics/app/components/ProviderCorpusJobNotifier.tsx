import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useActionQuery } from "@agent-native/core/client";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/AuthProvider";

type ProviderCorpusJobStatus =
  | "running"
  | "paused"
  | "quota_wait"
  | "completed"
  | "failed";

type ProviderCorpusJobEntry = {
  job: {
    id: string;
    name: string;
    mode: string;
    status: ProviderCorpusJobStatus;
    provider: string;
    updatedAt: string;
  };
  coverage: {
    pagesProcessed: number;
    batchesProcessed: number;
    itemsProcessed: number;
    matchedItems: number;
    totalHits: number;
    storedHits: number;
    truncatedHits: boolean;
  };
  error: string | null;
  nextResumeAt: string | null;
};

type ProviderCorpusJobsResponse = {
  jobs: ProviderCorpusJobEntry[];
  total: number;
};

const STORAGE_KEY = "analytics.providerCorpusJobNotifier.seen.v1";
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1_000;

export function ProviderCorpusJobNotifier() {
  const { auth, isLoading } = useAuth();
  const navigate = useNavigate();
  const seenRef = useRef<Record<string, string> | null>(null);
  const { data } = useActionQuery(
    "provider-corpus-jobs",
    { operation: "list", limit: 20 },
    {
      enabled: Boolean(auth) && !isLoading,
      refetchInterval: 15_000,
      refetchIntervalInBackground: true,
      retry: false,
    },
  );

  useEffect(() => {
    const jobs = (data as ProviderCorpusJobsResponse | undefined)?.jobs ?? [];
    if (!jobs.length) return;

    const seen = seenRef.current ?? readSeenJobs();
    seenRef.current = seen;
    let changed = false;

    for (const entry of jobs) {
      if (!shouldNotify(entry)) continue;
      const key = notificationKey(entry);
      if (seen[entry.job.id] === key) continue;

      showJobToast(entry, () => navigate("/ask"));
      seen[entry.job.id] = key;
      changed = true;
    }

    if (changed) writeSeenJobs(seen);
  }, [data, navigate]);

  return null;
}

function shouldNotify(entry: ProviderCorpusJobEntry): boolean {
  if (!["completed", "quota_wait", "failed"].includes(entry.job.status)) {
    return false;
  }
  const updatedAt = Date.parse(entry.job.updatedAt);
  return (
    Number.isFinite(updatedAt) && Date.now() - updatedAt <= RECENT_WINDOW_MS
  );
}

function notificationKey(entry: ProviderCorpusJobEntry): string {
  return [
    entry.job.status,
    entry.job.updatedAt,
    entry.coverage.itemsProcessed,
    entry.coverage.totalHits,
    entry.coverage.storedHits,
    entry.nextResumeAt ?? "",
    entry.error ?? "",
  ].join(":");
}

function showJobToast(entry: ProviderCorpusJobEntry, openAsk: () => void) {
  const title =
    entry.job.status === "completed"
      ? "Provider corpus job completed"
      : entry.job.status === "quota_wait"
        ? "Provider corpus job waiting for quota"
        : "Provider corpus job failed";
  const description = [
    `${entry.job.name} (${entry.job.provider})`,
    coverageSummary(entry),
    entry.nextResumeAt
      ? `Resume after ${formatDateTime(entry.nextResumeAt)}`
      : "",
    entry.error ?? "",
    `Job ${entry.job.id}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const options = {
    id: `provider-corpus-job-${entry.job.id}-${entry.job.status}`,
    description,
    duration: entry.job.status === "completed" ? 14_000 : 20_000,
    action: {
      label: "Open Ask",
      onClick: openAsk,
    },
  };

  if (entry.job.status === "failed") {
    toast.error(title, options);
  } else if (entry.job.status === "completed") {
    toast.success(title, options);
  } else {
    toast.message(title, options);
  }
}

function coverageSummary(entry: ProviderCorpusJobEntry): string {
  const units =
    entry.coverage.batchesProcessed > 0
      ? `${entry.coverage.batchesProcessed} batches`
      : `${entry.coverage.pagesProcessed} pages`;
  const hits = entry.coverage.truncatedHits
    ? `${entry.coverage.storedHits}/${entry.coverage.totalHits} hits stored`
    : `${entry.coverage.totalHits} hits`;
  return `${entry.coverage.itemsProcessed} items, ${entry.coverage.matchedItems} matched, ${hits}, ${units}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function readSeenJobs(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function writeSeenJobs(seen: Record<string, string>) {
  if (typeof window === "undefined") return;
  const entries = Object.entries(seen).slice(-100);
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // Best effort only; duplicate toasts are preferable to hiding job results.
  }
}
