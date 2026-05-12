"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyB16TJ4aBNjdE_xPmdXlTRBpNQthoHFagA",
  authDomain: "tafseer-ala7lam.firebaseapp.com",
  databaseURL: "https://tafseer-ala7lam-default-rtdb.firebaseio.com",
  projectId: "tafseer-ala7lam",
  storageBucket: "tafseer-ala7lam.firebasestorage.app",
  messagingSenderId: "111930949337",
  appId: "1:111930949337:web:d043dbe4bb27b427f108c8",
  measurementId: "G-KHPNSVMJHL"
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDatabase = getDatabase(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
