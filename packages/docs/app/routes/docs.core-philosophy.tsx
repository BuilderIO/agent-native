import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export function loader(_args: LoaderFunctionArgs) {
  return withSsrHtmlContentType(redirect("/docs/key-concepts"));
}

export default function CorePhilosophy() {
  return null;
}
