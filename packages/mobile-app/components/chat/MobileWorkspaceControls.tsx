import { IconCheck, IconChevronDown } from "@tabler/icons-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useMobileThemeColors } from "@/lib/mobile-colors";
import type { RemoteHost } from "@/lib/remote-sessions-api";

import { MobilePopover } from "./MobilePopover";

export type ChatTarget = "cloud" | "computer";
export { useMobileThemeColors } from "@/lib/mobile-colors";

function TargetOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { foreground } = useMobileThemeColors();
  return (
    <Pressable
      className="flex-row items-center justify-between border-b border-border px-4 py-3.5 active:bg-accent"
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text
        className={`text-[15px] ${
          selected
            ? "font-semibold text-popover-foreground"
            : "text-muted-foreground"
        }`}
      >
        {label}
      </Text>
      {selected ? (
        <IconCheck color={foreground} size={17} strokeWidth={2.2} />
      ) : null}
    </Pressable>
  );
}

export function MobileWorkspaceControls({
  target,
  hosts,
  selectedHostId,
  onTargetChange,
  onHostChange,
  onConnectComputer,
}: {
  target: ChatTarget;
  hosts: RemoteHost[];
  selectedHostId?: string;
  onTargetChange: (target: ChatTarget) => void;
  onHostChange: (hostId: string) => void;
  onConnectComputer: () => void;
}) {
  const { foreground, mutedForeground } = useMobileThemeColors();
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedHost = hosts.find((host) => host.id === selectedHostId);

  return (
    <>
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-1">
        <Pressable
          className="flex-row items-center gap-1.5 rounded-[7px] px-2 py-1.5 active:bg-accent"
          onPress={() => setMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Chat target: ${target === "cloud" ? "Cloud" : "Computer"}`}
        >
          <Text className="text-foreground text-[13px] font-semibold">
            {target === "cloud" ? "Cloud" : "Computer"}
          </Text>
          <IconChevronDown color={mutedForeground} size={14} strokeWidth={2} />
        </Pressable>
        {target === "computer" ? (
          <Pressable
            className="max-w-[180px] flex-row items-center gap-1 rounded-[7px] px-1.5 py-1.5 active:bg-accent"
            onPress={() => setMenuOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={
              selectedHost
                ? `Computer: ${selectedHost.name}`
                : "Connect computer"
            }
          >
            <Text
              className="text-muted-foreground text-[13px]"
              numberOfLines={1}
            >
              {selectedHost?.name ?? "Connect computer"}
            </Text>
            {hosts.length ? (
              <IconChevronDown
                color={mutedForeground}
                size={13}
                strokeWidth={2}
              />
            ) : null}
          </Pressable>
        ) : null}
      </View>

      <MobilePopover
        visible={menuOpen}
        title="Chat with"
        onClose={() => setMenuOpen(false)}
        bottomClassName="mb-28"
        accessibilityLabel="Dismiss chat target picker"
      >
        <TargetOption
          label="Cloud"
          selected={target === "cloud"}
          onPress={() => {
            onTargetChange("cloud");
            setMenuOpen(false);
          }}
        />
        <TargetOption
          label="Computer"
          selected={target === "computer"}
          onPress={() => {
            onTargetChange("computer");
            setMenuOpen(false);
          }}
        />
        {target === "computer" ? (
          <>
            {hosts.map((host) => (
              <Pressable
                key={host.id}
                className="flex-row items-center justify-between border-b border-border px-4 py-3.5 pl-7 active:bg-accent"
                onPress={() => {
                  onHostChange(host.id);
                  setMenuOpen(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: host.id === selectedHostId,
                }}
                accessibilityLabel={host.name}
              >
                <View className="flex-1">
                  <Text className="text-popover-foreground text-[14px]">
                    {host.name}
                  </Text>
                  <Text className="mt-0.5 text-muted-foreground text-[12px]">
                    {host.status === "online" ? "Available" : host.status}
                  </Text>
                </View>
                {host.id === selectedHostId ? (
                  <IconCheck color={foreground} size={16} strokeWidth={2.2} />
                ) : null}
              </Pressable>
            ))}
            <Pressable
              className="items-center px-4 py-3.5 active:bg-accent"
              onPress={() => {
                setMenuOpen(false);
                onConnectComputer();
              }}
              accessibilityRole="button"
              accessibilityLabel="Connect a computer"
            >
              <Text className="text-popover-foreground text-[13px] font-semibold">
                {hosts.length ? "Manage computers" : "Connect computer"}
              </Text>
            </Pressable>
          </>
        ) : null}
      </MobilePopover>
    </>
  );
}
