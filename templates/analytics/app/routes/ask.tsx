import { messagesByLocale } from "@/i18n-data";
import AskPage from "@/pages/Ask";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.ask }];
}

export default function AskRoute() {
  return <AskPage />;
}
