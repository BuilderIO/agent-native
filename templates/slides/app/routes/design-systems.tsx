import DesignSystems from "@/pages/DesignSystems";
import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.raw.routeDesignSystemsTitle }];
}

export default function DesignSystemsRoute() {
  return <DesignSystems />;
}
