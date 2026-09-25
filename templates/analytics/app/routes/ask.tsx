import enUSMessages from "@/i18n/en-US";
import AskPage from "@/pages/Ask";

export function meta() {
  return [{ title: enUSMessages.routeTitles.ask }];
}

export default function AskRoute() {
  return <AskPage />;
}
