// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResourceStateBoundary } from "./ResourceStateBoundary.js";

afterEach(() => {
  cleanup();
});

describe("ResourceStateBoundary", () => {
  it("renders the required skeleton with busy semantics while loading", () => {
    render(
      <ResourceStateBoundary
        data={undefined}
        isLoading={true}
        error={null}
        onRetry={vi.fn()}
        skeleton={<div data-testid="list-skeleton">Skeleton rows</div>}
        empty={{
          title: "No items",
          actionLabel: "Create item",
          onAction: vi.fn(),
        }}
      >
        {() => <div>Populated</div>}
      </ResourceStateBoundary>,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.getAttribute("data-craft-state")).toBe("loading");
    expect(screen.getByTestId("list-skeleton")).toBeTruthy();
  });

  it("renders an actionable error alert with retry when loading fails", () => {
    const onRetry = vi.fn();

    render(
      <ResourceStateBoundary
        data={undefined}
        isLoading={false}
        error={new Error("Database unavailable")}
        onRetry={onRetry}
        skeleton={<div>Skeleton</div>}
        empty={{
          title: "No items",
          actionLabel: "Create item",
          onAction: vi.fn(),
        }}
      >
        {() => <div>Populated</div>}
      </ResourceStateBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-craft-state")).toBe("error");
    expect(screen.getByText("Database unavailable")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("supports custom error rendering while preserving retry wiring", () => {
    const onRetry = vi.fn();

    render(
      <ResourceStateBoundary
        data={undefined}
        isLoading={false}
        error="Upstream timeout"
        onRetry={onRetry}
        skeleton={<div>Skeleton</div>}
        empty={<div>Empty</div>}
        renderError={({ message, onRetry: retry }) => (
          <div>
            <span>Custom: {message}</span>
            <button type="button" onClick={retry}>
              Reload now
            </button>
          </div>
        )}
      >
        {() => <div>Populated</div>}
      </ResourceStateBoundary>,
    );

    expect(screen.getByText("Custom: Upstream timeout")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload now" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders a structured empty state with an interactive CTA for empty arrays", () => {
    const onAction = vi.fn();

    render(
      <ResourceStateBoundary<string[]>
        data={[]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        skeleton={<div>Skeleton</div>}
        empty={{
          title: "No bookings yet",
          description: "Schedule the first meeting room slot for your team.",
          actionLabel: "New booking",
          onAction,
          icon: <span data-testid="empty-icon">Icon</span>,
        }}
      >
        {(items) => <div>{items.length} items</div>}
      </ResourceStateBoundary>,
    );

    expect(screen.getByTestId("empty-icon")).toBeTruthy();
    expect(screen.getByText("No bookings yet")).toBeTruthy();
    expect(
      screen.getByText("Schedule the first meeting room slot for your team."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "New booking" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("supports custom isEmpty predicates and custom ReactNode empty states", () => {
    render(
      <ResourceStateBoundary<{ rows: string[] }>
        data={{ rows: [] }}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        isEmpty={(value) => value.rows.length === 0}
        skeleton={<div>Skeleton</div>}
        empty={<button type="button">Add first row</button>}
      >
        {() => <div>Populated</div>}
      </ResourceStateBoundary>,
    );

    expect(screen.getByRole("button", { name: "Add first row" })).toBeTruthy();
  });

  it("renders populated children and preserves data during background refetches", () => {
    render(
      <ResourceStateBoundary<string[]>
        data={["Alpha", "Beta"]}
        isLoading={true}
        error={null}
        onRetry={vi.fn()}
        skeleton={<div>Skeleton</div>}
        empty={{
          title: "No items",
          actionLabel: "Add",
          onAction: vi.fn(),
        }}
      >
        {(items) => (
          <ul>
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </ResourceStateBoundary>,
    );

    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
