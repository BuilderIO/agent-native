import enUSMessages from "@/i18n/en-US";
import Agents from "@/pages/Agents";

export function meta() {
  return [{ title: enUSMessages.routeTitles.agents }];
}

export default function AgentsRoute() {
  return <Agents />;
}
