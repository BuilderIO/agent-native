import type { Locator, Page, Response } from "@playwright/test";
import { expect, it, vi } from "vitest";

import {
  magicSqlProposal,
  saveAskProjectFromShare,
} from "../e2e/phase1/flows-11-15.js";

it("targets the SQL result when the staged chart's fallback table repeats the sentinel", () => {
  const proposals = [
    { id: "sql-proposal", rows: ["13042"] },
    { id: "chart-proposal", rows: ["13042"] },
  ];
  const page = {
    locator(selector: string) {
      const proposalsInScope = proposals.filter(
        ({ id }) =>
          selector === "[data-notebook-proposal]" ||
          selector === `[data-notebook-proposal=${JSON.stringify(id)}]`,
      );
      return {
        getByRole(role: string, options: { name: string; exact: boolean }) {
          expect(role).toBe("cell");
          expect(options).toEqual({ name: "13042", exact: true });
          return proposalsInScope.flatMap(({ id, rows }) =>
            rows.filter((value) => value === options.name).map(() => id),
          );
        },
      };
    },
  } as unknown as Pick<Page, "locator">;
  expect(magicSqlProposal(page, "sql-proposal")).toEqual(["sql-proposal"]);
});

it("dismisses the Share dialog before reaching Save as project", async () => {
  let shareOpen = true;
  const response = {
    url: () =>
      "https://example.test/_agent-native/actions/save-analytics-thread-project",
    ok: () => true,
  } as Response;
  let deliver: (value: Response) => void = () => {};
  const receipt = new Promise<Response>((resolve) => {
    deliver = resolve;
  });
  const save = {
    click: vi.fn(async () => {
      expect(shareOpen).toBe(false);
      deliver(response);
    }),
  } as unknown as Locator;
  const close = vi.fn(async () => {
    expect(shareOpen).toBe(true);
    shareOpen = false;
  });
  const page = {
    getByRole(
      role: string,
      options: { name: string | RegExp; exact?: boolean },
    ) {
      if (role === "dialog") {
        expect("Share Orders by channel").toMatch(options.name);
        return {
          getByRole: (childRole: string, childOptions: { name: string }) => {
            expect(childRole).toBe("button");
            expect(childOptions.name).toBe("Close");
            return { click: close };
          },
        };
      }
      expect(role).toBe("button");
      expect(options).toEqual({ name: "Save as project", exact: true });
      return save;
    },
    async waitForResponse(matches: (response: Response) => boolean) {
      const saved = await receipt;
      expect(matches(saved)).toBe(true);
      return saved;
    },
  } as unknown as Page;
  await saveAskProjectFromShare({
    page,
    async require(control: Locator) {
      expect(control).toBe(save);
      expect(shareOpen).toBe(false);
    },
    missing(label: string): never {
      throw new Error(label);
    },
  });
  expect(close).toHaveBeenCalledOnce();
  expect(save.click).toHaveBeenCalledOnce();
});
