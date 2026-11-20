import { toast } from "sonner";
import { expect } from "vitest";

export function assertWarned() {
  expect(toast.error).toHaveBeenCalledWith("Could not save");
}
