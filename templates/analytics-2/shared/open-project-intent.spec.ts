import { describe, expect, it } from "vitest";

import {
  parseDashboardQuestion,
  parseOpenProjectIntent,
} from "./open-project-intent";

describe("parseOpenProjectIntent", () => {
  it.each([
    ["open project Orders by month - demo", "Orders by month - demo"],
    [
      "Open project Orders by month — demo data.",
      "Orders by month — demo data",
    ],
    ["open the project Revenue", "Revenue"],
    ["please open my dashboard called V3 metrics", "V3 metrics"],
    ["could you open dashboard Agent-Native?", "Agent-Native"],
    ["take me to project 'Weekly growth'", "Weekly growth"],
    ["go to the project Orders by month", "Orders by month"],
  ])("reads %j as a request to open %j", (text, title) => {
    expect(parseOpenProjectIntent(text)).toBe(title);
  });

  it.each([
    "How many orders did we get last month?",
    "open project",
    "open the file",
    "show me revenue by project",
    "show me project status",
    "open the Orders project",
    "create a project for orders",
    "open project Orders\nthen summarize it",
    "",
  ])("leaves %j to the normal Ask flow", (text) => {
    expect(parseOpenProjectIntent(text)).toBeNull();
  });
});

describe("parseDashboardQuestion", () => {
  it.each([
    ["How's my Agent-Native metrics doing in my V3 dashboard?", "V3"],
    ["How is revenue trending in the Growth dashboard?", "Growth"],
    ["What does my Weekly Orders project say about refunds?", "Weekly Orders"],
    ["Summarize our Q4 board dashboard", "Q4 board"],
    ["how are signups doing on my v3 dashboard", "v3"],
  ])("reads %j as a question about the dashboard %j", (text, ref) => {
    expect(parseDashboardQuestion(text)).toBe(ref);
  });

  it.each([
    "How many orders did we get last month?",
    "open the Orders project",
    "create a project for orders",
    "Show me revenue by project",
    "What is a dashboard?",
    "Build my new dashboard for churn",
    "How's this dashboard doing?",
    "How is my current project doing?",
    "How's my metrics doing in my V3 dashboard?\nand more",
    "",
  ])("leaves %j to the normal Ask flow", (text) => {
    expect(parseDashboardQuestion(text)).toBeNull();
  });
});
