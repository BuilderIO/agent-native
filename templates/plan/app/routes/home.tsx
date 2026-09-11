import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect } from "react-router";

export function loader() {
  return withSsrHtmlContentType(redirect("/plans"));
}

// Private app redirect retained at /home; / serves the public marketing page.
export default function IndexRedirect() {
  return null;
}
