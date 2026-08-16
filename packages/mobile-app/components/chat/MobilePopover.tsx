import { IconX } from "@tabler/icons-react-native";
import { Modal, Pressable, Text, View } from "react-native";

import {
  ModalSafeAreaProvider,
  SafeAreaView,
} from "@/components/uniwind-interop";
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
  const { foreground, mutedForeground } = useMobileThemeColors();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <ModalSafeAreaProvider style={{ flex: 1 }}>
        <Pressable
          className={`flex-1 justify-end ${overlayClassName}`}
          onPress={onClose}
          accessibilityLabel={accessibilityLabel ?? "Dismiss popover"}
        >
          <Pressable
            className={`mx-3 ${bottomClassName} overflow-hidden rounded-2xl border border-border-dark bg-card-dark shadow-2xl`}
            onPress={() => undefined}
          >
            <SafeAreaView edges={["bottom"]}>
              {title ? (
                <View className="flex-row items-center justify-between border-b border-border-dark px-4 py-3">
                  <Text className="text-foreground text-[15px] font-semibold">
                    {title}
                  </Text>
                  <Pressable
                    className="rounded-md p-1 active:bg-white/10"
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={`Close ${title.toLowerCase()}`}
                  >
                    <IconX
                      color={mutedForeground}
                      size={18}
                      strokeWidth={2.2}
                    />
                  </Pressable>
                </View>
              ) : null}
              {children}
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </ModalSafeAreaProvider>
    </Modal>
  );
}
