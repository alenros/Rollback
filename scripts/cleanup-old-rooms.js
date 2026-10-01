/**
 * Firebase cleanup script - removes rooms older than 24 hours
 * Usage: pnpm cleanup:firebase
 */

import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import dotenv from 'dotenv';

dotenv.config();

const firebaseConfig = {
    apiKey: process.env.PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.PUBLIC_FIREBASE_DATABASE_URL,
    projectId: process.env.PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.PUBLIC_FIREBASE_APP_ID
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const database = firebase.database();
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function cleanupOldRooms() {
    try {
        console.log('🧹 Starting Firebase cleanup...');

        const rooms = (await database.ref('rooms').once('value')).val();
        if (!rooms) {
            console.log('No rooms found in database.');
            return;
        }

        const now = Date.now();
        let deletedCount = 0;
        let keptCount = 0;

        for (const [roomCode, roomData] of Object.entries(rooms)) {
            const createdAt = roomData.createdAt;
            if (!createdAt) {
                console.log(`⚠️  Room ${roomCode} has no timestamp, keeping it...`);
                keptCount++;
            } else if (now - createdAt > MAX_AGE_MS) {
                console.log(`🗑️  Deleting room ${roomCode} (age: ${Math.floor((now - createdAt) / 3600000)}h)`);
                await database.ref(`rooms/${roomCode}`).remove();
                deletedCount++;
            } else {
                keptCount++;
            }
        }

        console.log('\n✅ Cleanup complete!');
        console.log(`   Deleted: ${deletedCount} rooms`);
        console.log(`   Kept: ${keptCount} rooms`);
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
        process.exitCode = 1;
    } finally {
        await database.goOffline();
        process.exit();
    }
}

cleanupOldRooms();
