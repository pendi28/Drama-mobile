import { getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAbq9J5HDASVnqn13VwRAOd_u1MdEWj3bE",
  authDomain: "drama-short-668af.firebaseapp.com",
  projectId: "drama-short-668af",
  storageBucket: "drama-short-668af.firebasestorage.app",
  messagingSenderId: "216564303270",
  appId: "1:216564303270:web:13633390eb9543196a3b67",
};

const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const db = getFirestore(app);

export const DECRYPT_BASE =
  "https://nb-dramabox-gentoken.vercel.app/decrypt-video?url=";

export function buildVideoUrl(rawUrl: string): string {
  return DECRYPT_BASE + encodeURIComponent(rawUrl);
}
