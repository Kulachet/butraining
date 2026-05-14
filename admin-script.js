const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));

try {
  const app = initializeApp({
    credential: applicationDefault(),
    projectId: firebaseConfig.projectId
  });
  console.log('App initialized');
  const db = getFirestore(app);
  db.collection("courses").limit(1).get().then(snap => {
    console.log(snap.size);
  }).catch(e => console.error('DB error', e));
} catch (e) {
  console.error("error initializing admin", e);
}
