import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: APP_TITLE },
    {
      name: "description",
      content:
        "Redirect to the task list home for this agent-native tasks app.",
    },
  ];
}

export function loader() {
  return withSsrHtmlContentType(redirect("/tasks"));
}

export default function IndexRedirect() {
  return null;
}
