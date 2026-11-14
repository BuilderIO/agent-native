import { toast } from "sonner";
import { describe, expect, it } from "vitest";

import { sonnerToast } from "./sonner.js";

describe("shared Sonner API", () => {
  it("re-exports the toast helper", () => {
    expect(sonnerToast).toBe(toast);
  });
});
