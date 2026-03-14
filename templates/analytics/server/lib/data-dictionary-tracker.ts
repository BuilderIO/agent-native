import { getDataDictionary, DataDictionaryEntry } from "./notion";
import { ContributionEvent } from "./contribution-scoring";

interface SnapshotCache {
  entries: DataDictionaryEntry[];
  timestamp: number;
}

// In-memory cache of previous snapshot
let previousSnapshot: SnapshotCache | null = null;

// Fields we track for contributions
const TRACKED_FIELDS = [
  "Definition",
  "QueryTemplate",
  "ExampleOutput",
  "ColumnsUsed",
  "JoinPattern",
  "UpdateFrequency",
  "DataLag",
  "Dependencies",
  "ValidDateRange",
  "CommonQuestions",
  "KnownGotchas",
  "ExampleUseCase",
  "Owner",
  "Department",
  "Cuts",
  "Table",
];

/**
 * Detect changes between current and previous snapshot
 */
export async function detectContributions(): Promise<ContributionEvent[]> {
  try {
    // Fetch current state
    const currentEntries = await getDataDictionary();

    // If no previous snapshot, save current and return empty
    if (!previousSnapshot) {
      previousSnapshot = {
        entries: currentEntries,
        timestamp: Date.now(),
      };
      return [];
    }

    // Build a map of previous entries by ID for fast lookup
    const previousMap = new Map(previousSnapshot.entries.map((e) => [e.id, e]));

    const events: ContributionEvent[] = [];

    // Check each current entry for changes
    for (const current of currentEntries) {
      const previous = previousMap.get(current.id);

      // New metric created
      if (!previous) {
        // Track the user who created it (if we had last_edited_by from Notion API)
        // For now, skip new metrics as we don't have attribution
        continue;
      }

      // Check each tracked field for changes
      for (const field of TRACKED_FIELDS) {
        const fieldKey = field as keyof DataDictionaryEntry;
        const oldValue = previous[fieldKey] as string;
        const newValue = current[fieldKey] as string;

        // Normalize values for comparison
        const oldNormalized = (oldValue || "").trim();
        const newNormalized = (newValue || "").trim();

        if (oldNormalized !== newNormalized) {
          // Field changed! Create contribution event
          // Note: Notion API doesn't expose last_edited_by in database query
          // We'd need to fetch each page individually to get that
          // For MVP, we'll track changes but won't have user attribution
          // In production, you'd fetch page metadata to get last_edited_by

          events.push({
            metricName: current.Metric,
            metricId: current.id,
            notionUserEmail: "unknown@builder.io", // TODO: Get from Notion page metadata
            fieldChanged: field,
            oldValue: oldNormalized || null,
            newValue: newNormalized,
            timestamp: new Date(),
          });
        }
      }
    }

    // Update snapshot
    previousSnapshot = {
      entries: currentEntries,
      timestamp: Date.now(),
    };

    return events;
  } catch (error) {
    console.error("Error detecting contributions:", error);
    return [];
  }
}

/**
 * Get the last snapshot timestamp
 */
export function getLastSnapshotTime(): Date | null {
  return previousSnapshot ? new Date(previousSnapshot.timestamp) : null;
}

/**
 * Force refresh the snapshot without detecting changes
 */
export async function refreshSnapshot(): Promise<void> {
  try {
    const entries = await getDataDictionary();
    previousSnapshot = {
      entries,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("Error refreshing snapshot:", error);
  }
}

/**
 * Clear the snapshot cache (useful for testing)
 */
export function clearSnapshot(): void {
  previousSnapshot = null;
}

/**
 * Get current snapshot for debugging
 */
export function getSnapshot(): SnapshotCache | null {
  return previousSnapshot;
}
