import { messagesByLocale } from "@/i18n-data";
import Agents from "@/pages/Agents";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.agents }];
}

export default function AgentsRoute() {
  return <Agents />;
}
