import messages from "@/i18n/en-US";
import { ResponsesPage } from "@/pages/ResponsesPage";

export function meta() {
  return [{ title: messages.routeTitles.responsesForms }];
}

export default function ResponsesRoute() {
  return <ResponsesPage />;
}
