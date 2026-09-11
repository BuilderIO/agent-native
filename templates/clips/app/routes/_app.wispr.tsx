import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect } from "react-router";

export function loader() {
  return withSsrHtmlContentType(redirect("/dictate"));
}

export default function LegacyWisprRedirect() {
  return null;
}
