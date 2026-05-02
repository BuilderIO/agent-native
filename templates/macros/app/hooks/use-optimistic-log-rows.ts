import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Exercise, Meal, Weight } from "@shared/types";

type LogKind = "meal" | "exercise" | "weight";

type LogRowByKind = {
  meal: Meal;
  exercise: Exercise;
  weight: Weight;
};

type LogRow = Meal | Exercise | Weight;

type OptimisticMeta = {
  __optimisticLogId: string;
  __optimisticFingerprint: string;
  __optimisticCreatedAt: string;
  __optimisticExpiresAt: number;
  __optimisticPending: boolean;
};

type OptimisticRow<T extends LogRow> = T &
  OptimisticMeta & {
    id: number;
    created_at: string;
  };

const TOOL_BY_KIND: Record<LogKind, string> = {
  meal: "log-meal",
  exercise: "log-exercise",
  weight: "log-weight",
};

const ACTIVE_TTL_MS = 120_000;
const RECONCILED_TTL_MS = 45_000;
const ERROR_TTL_MS = 1_500;
const SERVER_MATCH_WINDOW_MS = 2_000;

let optimisticSequence = 0;

export function useOptimisticLogRows<K extends LogKind>(
  kind: K,
  serverRows: Array<LogRowByKind[K]>,
  date: string,
) {
  const queryClient = useQueryClient();
  const toolName = TOOL_BY_KIND[kind];
  const [optimisticRows, setOptimisticRows] = useState<
    Array<OptimisticRow<LogRowByKind[K]>>
  >([]);

  useEffect(() => {
    const handleToolStart = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { tool?: string; input?: Record<string, unknown> }
        | undefined;

      if (detail?.tool !== toolName) return;

      const now = new Date();
      const row = buildOptimisticRow(kind, detail.input ?? {}, now);
      if (!row) return;

      setOptimisticRows((current) => [
        row as unknown as OptimisticRow<LogRowByKind[K]>,
        ...current,
      ]);
    };

    const handleToolDone = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { tool?: string; result?: unknown }
        | undefined;

      if (detail?.tool !== toolName) return;

      const resultRow = parseToolResult(detail.result);
      const resultFingerprint = resultRow
        ? createFingerprint(kind, resultRow)
        : null;
      const expiresAt =
        Date.now() + (resultRow ? RECONCILED_TTL_MS : ERROR_TTL_MS);

      setOptimisticRows((current) => {
        const matchIndex = findOptimisticMatch(current, resultFingerprint);
        if (matchIndex === -1) return current;

        if (!resultRow) {
          return current.map((row, index) =>
            index === matchIndex
              ? {
                  ...row,
                  __optimisticPending: false,
                  __optimisticExpiresAt: expiresAt,
                }
              : row,
          );
        }

        return current.map((row, index) =>
          index === matchIndex
            ? ({
                ...row,
                ...resultRow,
                __optimisticLogId: row.__optimisticLogId,
                __optimisticFingerprint:
                  resultFingerprint || row.__optimisticFingerprint,
                __optimisticCreatedAt: row.__optimisticCreatedAt,
                __optimisticExpiresAt: expiresAt,
                __optimisticPending: false,
              } as unknown as OptimisticRow<LogRowByKind[K]>)
            : row,
        );
      });

      if (resultRow) {
        queryClient.invalidateQueries({ queryKey: ["action"] });
      }
    };

    window.addEventListener("agent-native:tool-start", handleToolStart);
    window.addEventListener("agent-native:tool-done", handleToolDone);
    return () => {
      window.removeEventListener("agent-native:tool-start", handleToolStart);
      window.removeEventListener("agent-native:tool-done", handleToolDone);
    };
  }, [kind, queryClient, toolName]);

  useEffect(() => {
    setOptimisticRows((current) => {
      const next = current.filter(
        (row) =>
          !serverRows.some((serverRow) =>
            serverRowMatchesOptimistic(kind, serverRow, row),
          ),
      );
      return next.length === current.length ? current : next;
    });
  }, [kind, serverRows]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setOptimisticRows((current) => {
        const next = current.filter((row) => row.__optimisticExpiresAt > now);
        return next.length === current.length ? current : next;
      });
    }, 5_000);

    return () => window.clearInterval(interval);
  }, []);

  const visibleOptimisticRows = useMemo(
    () =>
      optimisticRows
        .filter((row) => row.date === date)
        .filter(
          (row) =>
            !serverRows.some((serverRow) =>
              serverRowMatchesOptimistic(kind, serverRow, row),
            ),
        )
        .sort(
          (a, b) =>
            Date.parse(b.__optimisticCreatedAt) -
            Date.parse(a.__optimisticCreatedAt),
        ),
    [kind, optimisticRows, serverRows, date],
  );

  const rows = useMemo(
    () => [...visibleOptimisticRows, ...serverRows],
    [visibleOptimisticRows, serverRows],
  );

  return {
    rows,
    hasOptimisticRows: visibleOptimisticRows.length > 0,
  };
}

export function isOptimisticLogRow(row: LogRow): boolean {
  const meta = row as Partial<OptimisticMeta> & { id?: number };
  return (
    typeof meta.__optimisticLogId === "string" &&
    (meta.__optimisticPending === true || (meta.id ?? 0) < 0)
  );
}

export function getLogRowKey(row: LogRow): string {
  const optimisticId = (row as Partial<OptimisticMeta>).__optimisticLogId;
  if (optimisticId) return `optimistic-${optimisticId}`;

  const id = (row as { id?: number }).id;
  return id == null ? createFingerprintFromUnknown(row) : `db-${id}`;
}

function buildOptimisticRow(
  kind: LogKind,
  input: Record<string, unknown>,
  now: Date,
): OptimisticRow<LogRow> | null {
  const id = -Date.now() - ++optimisticSequence;
  const createdAt = now.toISOString();
  const date = normalizeDate(input.date);
  const base = {
    id,
    date,
    created_at: createdAt,
    __optimisticLogId: `${kind}-${now.getTime()}-${optimisticSequence}`,
    __optimisticCreatedAt: createdAt,
    __optimisticExpiresAt: now.getTime() + ACTIVE_TTL_MS,
    __optimisticPending: true,
  };

  if (kind === "meal") {
    const row = {
      ...base,
      name: String(input.name || "Meal"),
      calories: numberOrDefault(input.calories, 0),
      protein: optionalNumber(input.protein),
      carbs: optionalNumber(input.carbs),
      fat: optionalNumber(input.fat),
      image_url: null,
      notes: null,
    };
    return {
      ...row,
      __optimisticFingerprint: createFingerprint(kind, row),
    };
  }

  if (kind === "exercise") {
    const row = {
      ...base,
      name: String(input.name || "Exercise"),
      calories_burned: numberOrDefault(
        input.calories_burned ?? input.calories,
        0,
      ),
      duration_minutes: optionalNumber(input.duration_minutes),
    };
    return {
      ...row,
      __optimisticFingerprint: createFingerprint(kind, row),
    };
  }

  if (input.weight == null) return null;
  const row = {
    ...base,
    weight: numberOrDefault(input.weight, 0),
    notes: input.notes == null ? null : String(input.notes),
  };
  return {
    ...row,
    __optimisticFingerprint: createFingerprint(kind, row),
  };
}

function findOptimisticMatch<T extends LogRow>(
  rows: Array<OptimisticRow<T>>,
  fingerprint: string | null,
): number {
  if (fingerprint) {
    const fingerprintMatch = rows.findIndex(
      (row) => row.__optimisticFingerprint === fingerprint,
    );
    if (fingerprintMatch !== -1) return fingerprintMatch;
  }

  const pendingMatch = rows.findIndex((row) => row.__optimisticPending);
  return pendingMatch === -1 ? 0 : pendingMatch;
}

function serverRowMatchesOptimistic(
  kind: LogKind,
  serverRow: LogRow,
  optimisticRow: OptimisticRow<LogRow>,
): boolean {
  if (serverRow.id != null && serverRow.id === optimisticRow.id) return true;

  const serverFingerprint = createFingerprint(kind, serverRow);
  if (serverFingerprint !== optimisticRow.__optimisticFingerprint) {
    return false;
  }

  const serverCreatedAt = getCreatedAt(serverRow);
  if (!serverCreatedAt) return true;

  const serverCreatedTime = Date.parse(serverCreatedAt);
  const optimisticCreatedTime = Date.parse(optimisticRow.__optimisticCreatedAt);
  if (
    !Number.isFinite(serverCreatedTime) ||
    !Number.isFinite(optimisticCreatedTime)
  ) {
    return true;
  }

  return serverCreatedTime >= optimisticCreatedTime - SERVER_MATCH_WINDOW_MS;
}

function createFingerprint(
  kind: LogKind,
  row: Record<string, unknown>,
): string {
  if (kind === "meal") {
    return [
      "meal",
      normalizeText(row.name),
      normalizeDate(row.date),
      normalizeNumber(row.calories),
      normalizeNumber(row.protein),
      normalizeNumber(row.carbs),
      normalizeNumber(row.fat),
    ].join("|");
  }

  if (kind === "exercise") {
    return [
      "exercise",
      normalizeText(row.name),
      normalizeDate(row.date),
      normalizeNumber(row.calories_burned),
      normalizeNumber(row.duration_minutes),
    ].join("|");
  }

  return [
    "weight",
    normalizeDate(row.date),
    normalizeNumber(row.weight),
    normalizeText(row.notes),
  ].join("|");
}

function createFingerprintFromUnknown(row: LogRow): string {
  if ("calories" in row) return createFingerprint("meal", row);
  if ("calories_burned" in row) return createFingerprint("exercise", row);
  return createFingerprint("weight", row);
}

function parseToolResult(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("Error")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function normalizeDate(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.split("T")[0];
  }

  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeNumber(value: unknown): string {
  const normalized = optionalNumber(value);
  return normalized == null ? "" : String(normalized);
}

function optionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return optionalNumber(value) ?? fallback;
}

function getCreatedAt(row: LogRow): string | null {
  const createdAt = (row as { created_at?: unknown }).created_at;
  return typeof createdAt === "string" ? createdAt : null;
}
