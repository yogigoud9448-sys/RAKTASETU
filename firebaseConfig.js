import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAxrWkB9-kR5KpuONAxxiL5PMxcYXLaXT8",
  authDomain: "raktsetu-ffd5e.firebaseapp.com",
  projectId: "raktsetu-ffd5e",
  storageBucket: "raktsetu-ffd5e.firebasestorage.app",
  messagingSenderId: "79094925016",
  appId: "1:79094925016:web:f0ab1aea9be7474b7339ad",
  measurementId: "G-PXCH49SPSZ"
};

// Firebase ఇనీషియలైజేషన్
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);