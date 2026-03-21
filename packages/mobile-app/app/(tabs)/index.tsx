import {
  View,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useApps } from "@/lib/use-apps";
import AppCard from "@/components/AppCard";
import type { AppConfig } from "@agent-native/shared-app-config";

export default function HomeScreen() {
  const { enabledApps, loading, removeApp } = useApps();
  const router = useRouter();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  function handleLongPress(app: AppConfig) {
    const options = [
      { text: "Edit", onPress: () => router.push(`/app/${app.id}?edit=1`) },
    ];

    if (!app.isBuiltIn) {
      options.push({
        text: "Remove",
        onPress: () => {
          Alert.alert("Remove App", `Remove "${app.name}" from your apps?`, [
            { text: "Cancel", style: "cancel" },
            {
              text: "Remove",
              style: "destructive",
              onPress: () => removeApp(app.id),
            },
          ]);
        },
      });
    }

    options.push({ text: "Cancel", onPress: () => {} });

    Alert.alert(app.name, app.description, options);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={enabledApps}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <AppCard
            app={item}
            onPress={() => router.push(`/app/${item.id}`)}
            onLongPress={() => handleLongPress(item)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111111",
  },
  grid: {
    padding: 10,
  },
});
