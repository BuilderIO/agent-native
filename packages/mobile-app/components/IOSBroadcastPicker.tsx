import {
  Platform,
  requireNativeComponent,
  View,
  type ViewProps,
} from "react-native";

const NativeBroadcastPicker =
  Platform.OS === "ios"
    ? requireNativeComponent<ViewProps>("AgentNativeBroadcastPicker")
    : null;

export default function IOSBroadcastPicker() {
  if (!NativeBroadcastPicker) return null;
  return (
    <View className="items-center h-[52px] justify-center w-[52px]">
      <NativeBroadcastPicker style={{ height: 52, width: 52 }} />
    </View>
  );
}
