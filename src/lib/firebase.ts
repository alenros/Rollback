import firebase from 'firebase/compat/app';
import 'firebase/compat/database';

// Firebase configuration from environment variables (see .env.example)
const firebaseConfig = {
    apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
    authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.PUBLIC_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.PUBLIC_FIREBASE_APP_ID
};

let database: firebase.database.Database | undefined;

/**
 * Initialize Firebase if not already initialized
 */
function getFirebaseApp(): firebase.app.App {
    return firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
}

/**
 * Get Firebase database instance (lazy singleton)
 */
function getDatabase(): firebase.database.Database {
    if (!database) {
        getFirebaseApp();
        database = firebase.database();
    }
    return database;
}

export { firebase, getDatabase, getFirebaseApp, firebaseConfig };
export default firebase;
