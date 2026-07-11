import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionQueryError } from "./action-query-error";

vi.mock("@agent-native/core/client", () => ({
  useT: () => (key: string) =>
    ({
      "dispatch.pages.dataLoadFailed": "Couldn't load data",
      "dispatch.pages.dataLoadFailedDescription":
        "Dispatch couldn't load this data.",
      "dispatch.pages.tryAgain": "Try again",
    })[key] ?? key,
}));

describe("ActionQueryError", () => {
  it("shows the query error and retries on request", () => {
    const onRetry = vi.fn();
    render(
      <ActionQueryError error={new Error("Database unavailable")} onRetry={onRetry} />,
    );

    expect(screen.getByText("Couldn't load data")).toBeInTheDocument();
    expect(screen.getByText("Database unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
