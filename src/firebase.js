// firebase.js
// Firebaseの初期化設定ファイル。
// Firebase Console でプロジェクトを作成し、
// 「プロジェクトの設定 > マイアプリ > SDK の設定と構成」から
// firebaseConfig の値をコピーして貼り付けてください。

import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';
import { getStorage }    from 'firebase/storage';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);

// オフライン時に発生した書き込みをIndexedDBにキューイングし、
// タブのリロード/一時的な回線切断を挟んでも再接続時に自動送信されるようにする。
// （requires firebase SDK v9.19 以降 / v10, v11 系で動作確認）
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});
export const storage = getStorage(app);

