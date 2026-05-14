import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc, query, where, limit } from "firebase/firestore";
import fs from "fs";

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  const q = query(collection(db, "registrations"), where("courseId", "==", "r03dpJJkCEg2hlyIcDBQ"));
  const regsSnap = await getDocs(q);
  console.log("Total registrations:", regsSnap.size);
  let completeCount = 0;
  let certSentCount = 0;
  regsSnap.forEach(doc => {
    if (doc.data().attended) completeCount++;
    if (doc.data().certStatus === 'sent') certSentCount++;
  });
  console.log("Complete:", completeCount, "Cert Sent:", certSentCount);
}

run();
