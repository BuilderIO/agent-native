export { default } from "../pages/DesignSystemSetup";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.designSystemSetup }];
}
