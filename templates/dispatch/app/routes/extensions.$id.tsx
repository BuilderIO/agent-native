export { default } from "@agent-native/dispatch/routes/pages/extensions.$id";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.extension }];
}
