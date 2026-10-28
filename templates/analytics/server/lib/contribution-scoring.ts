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

const POINT_VALUES: Record<string, number> = {
  "Query Template": 50,
  QueryTemplate: 50,
  "Join Pattern": 15,
  JoinPattern: 15,
  "Example Output": 15,
  ExampleOutput: 15,
  "Columns Used": 10,
  ColumnsUsed: 10,
  Dependencies: 10,

  Definition: 30,
  "Common Questions": 20,
  CommonQuestions: 20,
  "Known Gotchas": 20,
  KnownGotchas: 20,
  "Example Use Case": 15,
  ExampleUseCase: 15,

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

export function calculatePoints(
  event: ContributionEvent,
  persona?: PersonaType,
  isStale = false,
): number {
  const basePoints = POINT_VALUES[event.fieldChanged] || 5;

  const stalenessBonus = isStale ? 5 : 0;

  const firstTimeBonus =
    !event.oldValue || event.oldValue.trim() === "" ? 5 : 0;

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
      personaMultiplier = 0.5;
    }
  }

  const totalPoints = Math.floor(
    (basePoints + stalenessBonus + firstTimeBonus) * personaMultiplier,
  );

  return Math.max(totalPoints, 1);
}

export function calculateValidationPoints(
  rating: "accurate" | "mostly_accurate" | "needs_review",
  hasComment: boolean,
): number {
  let basePoints = 2;

  if (rating === "mostly_accurate") {
    basePoints = 3;
  } else if (rating === "needs_review") {
    basePoints = 5;
  }

  const commentBonus = hasComment ? 2 : 0;

  return basePoints + commentBonus;
}

export function isMetricStale(lastEditedAt: Date | string | null): boolean {
  if (!lastEditedAt) return true;

  const lastEdited =
    typeof lastEditedAt === "string" ? new Date(lastEditedAt) : lastEditedAt;
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  return lastEdited < ninetyDaysAgo;
}

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
