import { messagesByLocale } from "@/i18n-data";
import Team from "@/pages/Team";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.team }];
}

export default function TeamRoute() {
  return <Team />;
}
