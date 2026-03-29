import { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  StyleSheet,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useApps } from "@/lib/use-apps";
import AppForm from "@/components/AppForm";
import type { AppConfig } from "@agent-native/shared-app-config";

export default function SettingsScreen() {
  const { apps, updateApp, addApp, removeApp, resetToDefaults } = useApps();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingApp, setEditingApp] = useState<AppConfig | undefined>();

  const handleToggle = useCallback(
    (id: string, enabled: boolean) => {
      updateApp(id, { enabled });
    },
    [updateApp],
  );

  const handleModeToggle = useCallback(
    (id: string, mode: "dev" | "prod") => {
      updateApp(id, { mode });
    },
    [updateApp],
  );

  const handleEdit = useCallback((app: AppConfig) => {
    setEditingApp(app);
  }, []);

  const handleSaveEdit = useCallback(
    (app: AppConfig) => {
      if (editingApp) {
        updateApp(app.id, app);
      } else {
        addApp(app);
      }
      setEditingApp(undefined);
    },
    [editingApp, updateApp, addApp],
  );

  const handleRemove = useCallback(
    (app: AppConfig) => {
      Alert.alert("Remove App", `Remove "${app.name}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeApp(app.id),
        },
      ]);
    },
    [removeApp],
  );

  const handleReset = useCallback(() => {
    Alert.alert(
      "Reset to Defaults",
      "This will restore the default app list and remove any custom apps. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: resetToDefaults,
        },
      ],
    );
  }, [resetToDefaults]);

  return (
    <View style={styles.container}>
      <ScrollView>
        {/* Installed Apps */}
        <Text style={styles.sectionTitle}>Installed Apps</Text>
        {apps.map((app) => (
          <View key={app.id} style={styles.appRow}>
            <View style={styles.appInfo}>
              <View style={[styles.dot, { backgroundColor: app.color }]} />
              <View style={styles.appText}>
                <Text style={styles.appName}>{app.name}</Text>
                <Text style={styles.appUrl} numberOfLines={1}>
                  {app.url}
                </Text>
              </View>
            </View>
            <View style={styles.appActions}>
              <View style={styles.modeToggle}>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    (app.mode ?? "prod") === "prod" && styles.modeButtonActive,
                  ]}
                  onPress={() => handleModeToggle(app.id, "prod")}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      (app.mode ?? "prod") === "prod" &&
                        styles.modeButtonTextActive,
                    ]}
                  >
                    Prod
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    app.mode === "dev" && styles.modeButtonActive,
                  ]}
                  onPress={() => handleModeToggle(app.id, "dev")}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      app.mode === "dev" && styles.modeButtonTextActive,
                    ]}
                  >
                    Dev
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                onPress={() => handleEdit(app)}
                style={styles.editButton}
              >
                <Feather name="edit-2" size={16} color="#888888" />
              </TouchableOpacity>
              {!app.isBuiltIn && (
                <TouchableOpacity
                  onPress={() => handleRemove(app)}
                  style={styles.editButton}
                >
                  <Feather name="trash-2" size={16} color="#EF4444" />
                </TouchableOpacity>
              )}
              <Switch
                value={app.enabled}
                onValueChange={(v) => handleToggle(app.id, v)}
                trackColor={{ false: "#333333", true: "#555555" }}
                thumbColor={app.enabled ? "#ffffff" : "#666666"}
              />
            </View>
          </View>
        ))}

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowAddForm(true)}
          >
            <Feather name="plus" size={18} color="#ffffff" />
            <Text style={styles.addButtonText}>Add Custom App</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
            <Feather name="rotate-ccw" size={16} color="#EF4444" />
            <Text style={styles.resetButtonText}>Reset to Defaults</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Add form */}
      <AppForm
        visible={showAddForm}
        onClose={() => setShowAddForm(false)}
        onSave={(app) => {
          addApp(app);
          setShowAddForm(false);
        }}
      />

      {/* Edit form */}
      {editingApp && (
        <AppForm
          visible={true}
          onClose={() => setEditingApp(undefined)}
          onSave={handleSaveEdit}
          editApp={editingApp}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
  sectionTitle: {
    color: "#999999",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1A1A1A",
  },
  appInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  appText: {
    flex: 1,
  },
  appName: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "500",
  },
  appUrl: {
    color: "#666666",
    fontSize: 12,
    marginTop: 2,
  },
  appActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modeToggle: {
    flexDirection: "row",
    backgroundColor: "#1A1A1A",
    borderRadius: 6,
    padding: 2,
    gap: 1,
  },
  modeButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  modeButtonActive: {
    backgroundColor: "#333333",
  },
  modeButtonText: {
    color: "#555555",
    fontSize: 11,
    fontWeight: "600",
  },
  modeButtonTextActive: {
    color: "#ffffff",
  },
  editButton: {
    padding: 6,
  },
  actions: {
    padding: 16,
    gap: 12,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A1A",
    borderRadius: 10,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: "#33333366",
  },
  addButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "500",
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    gap: 8,
  },
  resetButtonText: {
    color: "#EF4444",
    fontSize: 14,
  },
});
