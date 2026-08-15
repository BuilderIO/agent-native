import {
  IconApps,
  IconCalendarEvent,
  IconCamera,
  IconMicrophone,
  IconSettings,
  IconUsers,
  IconX,
} from "@tabler/icons-react-native";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { TAB_BAR_ACTION_SIZE } from "@/lib/tab-bar-layout";

interface QuickAction {
  href: string;
  label: string;
  tileClass: string;
  icon: ReactNode;
}

const ACTIONS: QuickAction[] = [
  {
    href: "/capture/dictate",
    label: "Dictate",
    tileClass: "bg-accent-green",
    icon: <IconMicrophone color="#0b0b0c" size={23} strokeWidth={1.9} />,
  },
  {
    href: "/capture/audio",
    label: "Meeting",
    tileClass: "bg-accent-blue",
    icon: <IconUsers color="#0b0b0c" size={23} strokeWidth={1.9} />,
  },
  {
    href: "/capture/video",
    label: "Video",
    tileClass: "bg-accent-pink",
    icon: <IconCamera color="#0b0b0c" size={23} strokeWidth={1.9} />,
  },
  {
    href: "/apps",
    label: "Apps",
    tileClass: "bg-card-dark border border-border-dark",
    icon: <IconApps color="#f4f4f5" size={23} strokeWidth={1.8} />,
  },
  {
    href: "/app/calendar",
    label: "Calendar",
    tileClass: "bg-card-dark border border-border-dark",
    icon: <IconCalendarEvent color="#f4f4f5" size={23} strokeWidth={1.8} />,
  },
  {
    href: "/settings",
    label: "Settings",
    tileClass: "bg-card-dark border border-border-dark",
    icon: <IconSettings color="#f4f4f5" size={23} strokeWidth={1.8} />,
  },
];

interface QuickActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Aligns the close button with the tab bar's quick-action button. */
  bottom: number;
}

export default function QuickActionsSheet({
  visible,
  onClose,
  bottom,
}: QuickActionsSheetProps) {
  const router = useRouter();

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel="Dismiss quick actions"
        className="flex-1 justify-end"
        onPress={onClose}
      >
        <BlurView intensity={22} style={StyleSheet.absoluteFill} tint="dark" />
        <View
          className="flex-row items-end gap-2.5 px-3"
          style={{ marginBottom: bottom }}
        >
          <Pressable className="flex-1 bg-panel-bg border border-overlay-border rounded-3xl p-2">
            <View className="flex-row flex-wrap">
              {ACTIONS.map((action) => (
                <Pressable
                  accessibilityRole="button"
                  className="items-center w-1/3 px-1 py-2.5 active:opacity-70"
                  key={action.href}
                  onPress={() => {
                    onClose();
                    router.push(action.href as never);
                  }}
                >
                  <View
                    className={`items-center justify-center rounded-2xl h-13 w-13 ${action.tileClass}`}
                  >
                    {action.icon}
                  </View>
                  <Text
                    className="text-text-light text-xs font-semibold mt-2"
                    numberOfLines={1}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel="Close quick actions"
            accessibilityRole="button"
            className="items-center bg-panel-bg border border-overlay-border rounded-full justify-center active:opacity-70"
            onPress={onClose}
            style={{ height: TAB_BAR_ACTION_SIZE, width: TAB_BAR_ACTION_SIZE }}
          >
            <IconX color="#f4f4f5" size={22} strokeWidth={2} />
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
