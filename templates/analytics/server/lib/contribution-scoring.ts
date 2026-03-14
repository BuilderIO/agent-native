import { PersonaType } from "./user-persona";

export interface ContributionEvent {
  metricName: string;
  metricId: string;
  notionUserId?: string;
  notionUserEmail: string;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string;
  timestamp: Date;
}

// Point values by contribution type
const POINT_VALUES: Record<string, number> = {
  // High value technical contributions
  "Query Template": 50,
  QueryTemplate: 50,
  "Join Pattern": 15,
  JoinPattern: 15,
  "Example Output": 15,
  ExampleOutput: 15,
  "Columns Used": 10,
  ColumnsUsed: 10,
  Dependencies: 10,

  // Business definitions and documentation
  Definition: 30,
  "Common Questions": 20,
  CommonQuestions: 20,
  "Known Gotchas": 20,
  KnownGotchas: 20,
  "Example Use Case": 15,
  ExampleUseCase: 15,

  // Metadata updates
  "Update Frequency": 10,
  UpdateFrequency: 10,
  "Data Lag": 10,
  DataLag: 10,
  "Valid Date Range": 10,
  ValidDateRange: 10,
  Owner: 10,
  Department: 5,
  Cuts: 5,
  Table: 5,
};

/**
 * Calculate points for a contribution event
 */
export function calculatePoints(
  event: ContributionEvent,
  persona?: PersonaType,
  isStale = false
): number {
  // Get base points for the field type
  const basePoints = POINT_VALUES[event.fieldChanged] || 5;

  // Bonus for updating stale metrics (>90 days since last edit)
  const stalenessBonus = isStale ? 5 : 0;

  // Bonus for first-time field population (old value was empty)
  const firstTimeBonus = !event.oldValue || event.oldValue.trim() === "" ? 5 : 0;

  // Department heads get slightly reduced points for technical fields
  // (encourages them to route to analytics team instead)
  let personaMultiplier = 1.0;
  if (persona === "dept_head") {
    const technicalFields = [
      "Query Template",
      "QueryTemplate",
      "Join Pattern",
      "JoinPattern",
      "Example Output",
      "ExampleOutput",
      "Columns Used",
      "ColumnsUsed",
    ];
    if (technicalFields.includes(event.fieldChanged)) {
      personaMultiplier = 0.5; // Reduced points, encourage routing
    }
  }

  const totalPoints = Math.floor(
    (basePoints + stalenessBonus + firstTimeBonus) * personaMultiplier
  );

  return Math.max(totalPoints, 1); // Minimum 1 point
}

/**
 * Calculate points for a validation submission
 */
export function calculateValidationPoints(
  rating: "accurate" | "mostly_accurate" | "needs_review",
  hasComment: boolean
): number {
  let basePoints = 2; // Default for accurate validation

  if (rating === "mostly_accurate") {
    basePoints = 3;
  } else if (rating === "needs_review") {
    basePoints = 5; // More points for flagging issues
  }

  // Bonus for adding helpful comments
  const commentBonus = hasComment ? 2 : 0;

  return basePoints + commentBonus;
}

/**
 * Check if a metric is considered stale (last edited >90 days ago)
 */
export function isMetricStale(lastEditedAt: Date | string | null): boolean {
  if (!lastEditedAt) return true;

  const lastEdited = typeof lastEditedAt === "string" ? new Date(lastEditedAt) : lastEditedAt;
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  return lastEdited < ninetyDaysAgo;
}

/**
 * Get a human-readable description of the contribution type
 */
export function getContributionDescription(fieldName: string): string {
  const descriptions: Record<string, string> = {
    "Query Template": "Added SQL query template",
    QueryTemplate: "Added SQL query template",
    Definition: "Updated business definition",
    "Common Questions": "Added common questions",
    CommonQuestions: "Added common questions",
    "Known Gotchas": "Documented known gotchas",
    KnownGotchas: "Documented known gotchas",
    "Example Use Case": "Added example use case",
    ExampleUseCase: "Added example use case",
    "Join Pattern": "Added join pattern",
    JoinPattern: "Added join pattern",
    "Example Output": "Added example output",
    ExampleOutput: "Added example output",
    Owner: "Assigned metric owner",
    Department: "Updated department",
  };

  return descriptions[fieldName] || `Updated ${fieldName}`;
}

/**
 * Get emoji icon for contribution type
 */
export function getContributionIcon(fieldName: string): string {
  const icons: Record<string, string> = {
    "Query Template": "🔍",
    QueryTemplate: "🔍",
    Definition: "📝",
    "Common Questions": "💬",
    CommonQuestions: "💬",
    "Known Gotchas": "⚠️",
    KnownGotchas: "⚠️",
    "Example Use Case": "💡",
    ExampleUseCase: "💡",
    "Join Pattern": "🔗",
    JoinPattern: "🔗",
    "Example Output": "📊",
    ExampleOutput: "📊",
    Owner: "👤",
    Department: "🏢",
  };

  return icons[fieldName] || "✏️";
}
