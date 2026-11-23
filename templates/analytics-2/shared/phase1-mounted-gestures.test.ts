import type { Locator, Response } from "@playwright/test";
import { expect, it, vi } from "vitest";

import { pressSqlRun } from "../e2e/phase1/mounted-gestures.js";

it("waits for the mounted Run control before sending the SQL shortcut", async () => {
  let enableRun: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    enableRun = resolve;
  });
  const receipt = { status: () => 200 } as Response;
  const run = { click: vi.fn(() => ready) };
  const editor = { press: vi.fn(async () => {}) };
  const cell = {
    getByRole: vi.fn(() => run),
    locator: vi.fn(() => editor),
  } as unknown as Locator;
  const observeAdmission = vi.fn(async () => receipt);

  const result = pressSqlRun(cell, observeAdmission);
  expect(run.click).toHaveBeenCalledWith({ trial: true, timeout: 30_000 });
  expect(observeAdmission).not.toHaveBeenCalled();
  expect(editor.press).not.toHaveBeenCalled();

  enableRun();
  await expect(result).resolves.toBe(receipt);
  expect(observeAdmission).toHaveBeenCalledExactlyOnceWith();
  expect(editor.press).toHaveBeenCalledExactlyOnceWith("ControlOrMeta+Enter");
  expect(observeAdmission.mock.invocationCallOrder[0]).toBeLessThan(
    editor.press.mock.invocationCallOrder[0] ?? 0,
  );
});
