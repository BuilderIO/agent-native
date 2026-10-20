import { IconX } from "@tabler/icons-react-native";
import { Pressable, Text, View } from "react-native";

import { MobileSheet } from "@/components/MobileSheet";
import { SafeAreaView } from "@/components/uniwind-interop";
import { useMobileThemeColors } from "@/lib/mobile-colors";

export function MobilePopover({
  visible,
  title,
  onClose,
  children,
  bottomClassName = "mb-8",
  overlayClassName = "bg-black/45",
  accessibilityLabel,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  bottomClassName?: string;
  overlayClassName?: string;
  accessibilityLabel?: string;
}) {
  const { mutedForeground } = useMobileThemeColors();
  return (
    <MobileSheet
      visible={visible}
      onClose={onClose}
      motion="popover"
      contentClassName={`mx-3 ${bottomClassName} overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl`}
      overlayClassName={overlayClassName}
      accessibilityLabel={accessibilityLabel ?? "Dismiss popover"}
    >
      <SafeAreaView edges={["bottom"]}>
        {title ? (
          <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
            <Text className="text-popover-foreground text-[15px] font-semibold">
              {title}
            </Text>
            <Pressable
              className="rounded-md p-1 active:bg-accent"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title.toLowerCase()}`}
            >
              <IconX color={mutedForeground} size={18} strokeWidth={2.2} />
            </Pressable>
          </View>
        ) : null}
        {children}
      </SafeAreaView>
    </MobileSheet>
  );
}
