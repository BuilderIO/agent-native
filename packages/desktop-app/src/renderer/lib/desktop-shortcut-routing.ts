export function shouldRouteDesktopAppToChatFirst(input: {
  chatFirstMode: boolean;
  showCodeAgentsTab: boolean;
}): boolean {
  return input.chatFirstMode && input.showCodeAgentsTab;
}
