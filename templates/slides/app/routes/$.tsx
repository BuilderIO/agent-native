import NotFound from "@/pages/NotFound";
import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.raw.routeNotFoundTitle }];
}

export default function CatchAllRoute() {
  return <NotFound />;
}
