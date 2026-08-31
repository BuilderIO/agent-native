import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

export function meta() {
  return [{ title: "{{APP_TITLE}}" }];
}

export default function MarketingHomeRoute() {
  return (
    <MarketingHome
      appName="{{APP_TITLE}}"
      tagline="Build with your AI agent."
      description="A starter app for building Agent-Native workflows."
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
