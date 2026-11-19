import "./ShareButton.browser.css";
import type { ShareButtonController } from "@agent-native/core/client/sharing/useShareButtonController";
import { useShareVisibilityTransition } from "@agent-native/core/client/sharing/useShareVisibilityTransition";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";

import { Popover, PopoverAnchor, PopoverContent } from "../../ui/popover.js";
import {
  ShareGeneralAccessRow,
  SharePeopleInvite,
} from "../sharing/ShareButton.js";

const members = Array.from({ length: 25 }, (_, i) => ({
  email: `person${i}@example.test`,
  name: `Person ${i}`,
  role: "member",
}));
function Harness() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [visibility, setVisibility] = useState<"private" | "org" | "public">(
    "private",
  );
  const transition = useShareVisibilityTransition({
    resourceType: "document",
    resourceId: "test",
    current: visibility,
    orgId: null,
    canManage: true,
    active: true,
    apply: async (next) => setVisibility(next),
    onDirectError: () => {},
  });
  const controller = {
    inviteEmail: value,
    setInviteEmail: setValue,
    policy: { allowPublic: true },
    canManage: true,
    role: "viewer",
    setRole: () => {},
    notifyPeople: false,
    setNotifyPeople: () => {},
    messageOpen: false,
    setMessageOpen: () => {},
    shareError: null,
    setShareError: () => {},
    suggestionsOpen: open,
    setSuggestionsOpen: setOpen,
    memberSearch: {
      members,
      isLoading: false,
      hasMore: false,
      isLoadingMore: false,
      loadMore: () => {},
    },
    memberSuggestions: members,
    groupSuggestions: [],
    agentSuggestions: [],
    selectGroup: () => {},
    selectAgent: () => {},
    selectedAgent: null,
    handleAdd: () => {},
    data: { shares: [] },
    visibility,
    visibilityTransition: transition,
    handleVisibility: (next: typeof visibility) =>
      void transition.request(next),
  } as unknown as ShareButtonController;
  return (
    <Popover defaultOpen>
      <PopoverAnchor asChild>
        <span className="fixed end-4 top-16 size-px" />
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="max-h-[calc(100dvh-1rem)] w-[384px] max-w-[calc(100vw-1rem)] overflow-y-auto p-4"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.target as HTMLElement)
            .querySelector<HTMLInputElement>('input[role="combobox"]')
            ?.focus();
        }}
      >
        <div className="flex flex-col gap-4">
          <SharePeopleInvite controller={controller} />
          <div>People with access</div>
          <div>Owner</div>
          <section>
            General access
            <ShareGeneralAccessRow controller={controller} />
          </section>
        </div>
      </PopoverContent>
    </Popover>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing test root");
createRoot(root).render(
  <QueryClientProvider client={new QueryClient()}>
    <Harness />
  </QueryClientProvider>,
);
