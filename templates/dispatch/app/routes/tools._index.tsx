export { default } from "@agent-native/dispatch/routes/pages/tools._index";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.extensions }];
}
