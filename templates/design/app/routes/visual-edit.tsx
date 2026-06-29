import { messagesByLocale } from "@/i18n-data";

export { default } from "../pages/VisualEdit";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.visualEdit }];
}
