export { default } from "../pages/DesignEditor";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.designEditor }];
}
