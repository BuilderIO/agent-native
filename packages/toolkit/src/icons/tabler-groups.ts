import type { TablerIconCategory } from "./catalog.js";

export const TABLER_ICON_GROUPS = [
  {
    id: "documents-communication",
    label: "Documents & communication",
    categories: ["document", "communication"],
  },
  {
    id: "people-expression",
    label: "People & expression",
    categories: ["mood", "gestures", "gender", "badges"],
  },
  {
    id: "places-nature",
    label: "Places & nature",
    categories: [
      "buildings",
      "map",
      "vehicles",
      "nature",
      "animals",
      "weather",
    ],
  },
  {
    id: "media-activities",
    label: "Media & activities",
    categories: ["media", "photography", "food", "health", "sport", "games"],
  },
  {
    id: "business-data",
    label: "Business & data",
    categories: ["database", "charts", "e-commerce", "currencies", "brand"],
  },
  {
    id: "objects-symbols",
    label: "Objects & symbols",
    categories: [
      "system",
      "arrows",
      "shapes",
      "symbols",
      "text",
      "letters",
      "numbers",
      "electrical",
      "laundry",
      "zodiac",
    ],
  },
  {
    id: "more",
    label: "More categories",
    categories: [
      "design",
      "development",
      "devices",
      "computers",
      "math",
      "logic",
      "version-control",
      "extensions",
    ],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  categories: readonly TablerIconCategory[];
}>;
