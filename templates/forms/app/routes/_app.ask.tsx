import messages from "@/i18n/en-US";
import { AskPage } from "@/pages/AskPage";

export function meta() {
  return [
    {
      title: `${messages.navigation.askForms} - ${messages.navigation.brand}`,
    },
  ];
}

export default function AskRoute() {
  return <AskPage />;
}
