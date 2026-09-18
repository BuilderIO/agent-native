import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect } from "react-router";

export function loader() {
  return withSsrHtmlContentType(redirect("/", 302));
}

export default function ExamplesRedirect() {
  return null;
}
