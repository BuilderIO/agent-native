// The Tasks surface the tester opened must be mounted: the sidebar row only renders
// when a home/tasks page is registered, and /home/tasks has to resolve to the Tasks
// section rather than falling back to Home (row 221).
import { describe, expect, it } from "vitest";

import { taskScheduleCron } from "../../../actions/create-scheduled-task";
import { resolveRoute } from "../../routes/routing/registry";
import { hasRoutePage } from "../workspace/pages";

describe("the Tasks surface is mounted", () => {
  it("registers a home/tasks page, which is what the sidebar row is gated on", () => {
    expect(hasRoutePage("home", "tasks")).toBe(true);
  });

  it("resolves /home/tasks to the Tasks section, not Home", () => {
    const route = resolveRoute("/home/tasks", {
      authenticated: true,
      tasksEnabled: true,
    });
    expect(route.view).toBe("tasks");
    expect(route.selectedTab).toBe("tasks");
    expect(route.title).toBe("Tasks");
  });

  it("resolves /tasks, the path the tester typed, to the same section", () => {
    expect(
      resolveRoute("/tasks", { authenticated: true, tasksEnabled: true }).to,
    ).toBe("/home/tasks");
  });
});

describe("a task's cadence becomes a cron the scheduler can run", () => {
  it("builds daily, weekly and monthly schedules", () => {
    expect(taskScheduleCron({ cadence: "daily", hour: 9, minute: 30 })).toBe(
      "30 9 * * *",
    );
    expect(
      taskScheduleCron({ cadence: "weekly", hour: 8, minute: 0, dayOfWeek: 3 }),
    ).toBe("0 8 * * 3");
    expect(
      taskScheduleCron({
        cadence: "monthly",
        hour: 6,
        minute: 15,
        dayOfMonth: 12,
      }),
    ).toBe("15 6 12 * *");
  });

  it("refuses an impossible time instead of scheduling silently", () => {
    expect(() =>
      taskScheduleCron({ cadence: "daily", hour: 24, minute: 0 }),
    ).toThrow();
    expect(() =>
      taskScheduleCron({ cadence: "daily", hour: 9, minute: 60 }),
    ).toThrow();
  });
});
