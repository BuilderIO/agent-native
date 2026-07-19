import {
  Platform,
  requireNativeComponent,
  StyleSheet,
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
    <View style={styles.container}>
      <NativeBroadcastPicker style={styles.picker} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  picker: { height: 52, width: 52 },
});
