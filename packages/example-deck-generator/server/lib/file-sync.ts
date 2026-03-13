import "./firebase-init.js";
import { getFirestore } from "firebase-admin/firestore";
import { initFileSync as coreInitFileSync } from "@agent-native/core/adapters/firestore";

const APP_ID = "deck-generator";

export async function initFileSync() {
  const db = getFirestore();
  const collection = db.collection("fusionAppFiles");

  await coreInitFileSync({
    appId: APP_ID,
    dataDir: "data",
    syncConfigPath: "data/sync-config.json",
    collection: {
      doc: (id: string) => collection.doc(id),
      where: (...args: any[]) => collection.where(...args),
      onSnapshot: (cb: any) => collection.onSnapshot(cb),
    },
  });
}
