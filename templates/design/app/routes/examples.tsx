import { redirect } from "react-router";

import { messagesByLocale } from "@/i18n-data";

export function loader() {
  return redirect("/templates", 301);
}

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.designTemplates }];
}

export default function ExamplesRedirect() {
  return null;
}
