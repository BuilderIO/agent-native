import messages from "@/i18n/en-US";
import Team from "@/pages/Team";

export function meta() {
  return [{ title: messages.mail.routeTitles.team }];
}

export default function TeamRoute() {
  return <Team />;
}
