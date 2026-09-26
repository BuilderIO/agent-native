import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect } from "react-router";

export function loader() {
  return withSsrHtmlContentType(redirect("/plans"));
}

export default function IndexRedirect() {
  return null;
}
