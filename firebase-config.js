// ===========================================================================
//  Firebase setup — THIS is the only file you need to edit for sharing.
//  Full walkthrough with screenshots-worth of detail is in SETUP.md.
//
//  Quick version:
//    1. Make a free project at https://console.firebase.google.com
//    2. Add a "Web app"; copy its config object over FIREBASE_CONFIG below.
//    3. Turn on Firestore Database and Google sign-in (see SETUP.md).
//    4. Commit + push, open the site, click "Sign in", and it will show you a
//       User ID. Paste that into OWNER_UID below (and into your Firestore
//       rules), then commit + push again.
//
//  Until FIREBASE_CONFIG is filled in, the planner runs in LOCAL-ONLY mode:
//  it saves to this browser only (nothing is shared) and everything still
//  works exactly as before. So it's safe to deploy before finishing setup.
// ===========================================================================

// Paste your Firebase web-app config object here (replace every "PASTE_ME").
const FIREBASE_CONFIG = {
  apiKey: "PASTE_ME",
  authDomain: "PASTE_ME",
  projectId: "PASTE_ME",
  storageBucket: "PASTE_ME",
  messagingSenderId: "PASTE_ME",
  appId: "PASTE_ME",
};

// The ONLY account allowed to edit. Everyone else (your boss) can view only.
// Leave as "PASTE_ME" for now; you'll fill it in after your first sign-in.
const OWNER_UID = "PASTE_ME";
