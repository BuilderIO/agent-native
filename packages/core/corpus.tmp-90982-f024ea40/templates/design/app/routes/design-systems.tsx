export { default } from "../pages/DesignSystems";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.designSystems }];
}
