import { vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
