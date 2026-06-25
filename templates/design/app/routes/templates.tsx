export { default } from "../pages/Templates";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.designTemplates }];
}
