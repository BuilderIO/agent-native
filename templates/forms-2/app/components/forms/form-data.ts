import { useActionQuery } from "@agent-native/core/client/hooks";
import type { FormDetail } from "@shared/form-contract";
import { useOutletContext } from "react-router";

export function errorCodeOf(error: unknown): string | undefined {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return typeof code === "string" ? code : undefined;
}

export function isNotFound(error: unknown): boolean {
  return errorCodeOf(error) === "not_found";
}

export { publicFormUrl } from "@/lib/public-url";

export function useFormDetail(id: string) {
  return useActionQuery("get-form", { id });
}

/** Author name for the avatar chip; the first letter of the account name. */
export function initialOf(name: string | undefined | null): string {
  return (name?.trim()[0] ?? "?").toUpperCase();
}

export function useFormOutlet() {
  return useOutletContext<{ form: FormDetail }>().form;
}
