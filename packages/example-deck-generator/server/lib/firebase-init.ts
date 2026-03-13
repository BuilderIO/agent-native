import { initializeApp, cert, getApps } from "firebase-admin/app";

const FIREBASE_PROJECT_ID = "builder-3b0a2";

if (getApps().length === 0) {
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (credentialsJson) {
    const serviceAccount = JSON.parse(credentialsJson);
    initializeApp({
      credential: cert(serviceAccount),
      projectId: FIREBASE_PROJECT_ID,
    });
  } else {
    initializeApp({ projectId: FIREBASE_PROJECT_ID });
  }
}
