import { ResponsesPage } from "@/pages/ResponsesPage";
import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.routeTitles.responsesForms }];
}

export default function ResponsesRoute() {
  return <ResponsesPage />;
}
