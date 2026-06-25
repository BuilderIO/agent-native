import messages from "@/i18n/en-US";
import { NotFound } from "@/pages/NotFound";

export function meta() {
  return [{ title: messages.mail.routeTitles.notFound }];
}

export default function CatchAllRoute() {
  return <NotFound />;
}
