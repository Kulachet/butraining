import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));

try {
  const app = initializeApp({
    credential: applicationDefault(),
    projectId: firebaseConfig.projectId
  });
  console.log('App initialized');
  const db = getFirestore(app);
  db.collection("courses").limit(1).get().then(snap => {
    console.log("Size:", snap.size);
  }).catch(e => console.error('DB error', e));
} catch (e) {
  console.error("error initializing admin", e);
}
