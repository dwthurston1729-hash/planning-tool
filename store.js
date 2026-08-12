// ===========================================================================
//  Shared persistence + sign-in layer.  You should not need to edit this file
//  — put your project details in firebase-config.js instead.
//
//  What it does:
//    - If Firebase is configured, it makes a small cloud database (Firestore)
//      the shared source of truth. Your edits are pushed there and show up for
//      anyone with the link. Viewers (not signed in as the owner) get live
//      updates and cannot edit.
//    - localStorage is kept as a fast local cache / offline copy, so the rest
//      of the app keeps working synchronously and offline.
//    - If Firebase is NOT configured yet, everything falls back to local-only
//      behavior (saves to this browser only).
//
//  Firestore layout:
//    days/<YYYY-MM-DD>  ->  { active, completed, dayNotes }
//    meta/future        ->  { rows: [...] }
//    meta/stats         ->  { counts: { "<YYYY-MM-DD>": completedCount } }
//    meta/inbox         ->  { counts: { "<YYYY-MM-DD>": inboxSizeAt5pm } }
//    meta/tlagenda      ->  { rows: [ {event, date} × 10 ] }  (standing list)
// ===========================================================================

(function () {
  const DRAFT_PREFIX = "plan-draft:";
  const STATS_KEY = "plan-stats";
  const FUTURE_KEY = "plan-future";
  const INBOX_KEY = "plan-inbox";
  const AGENDA_KEY = "plan-agenda";

  const configured =
    typeof FIREBASE_CONFIG === "object" &&
    FIREBASE_CONFIG &&
    FIREBASE_CONFIG.apiKey &&
    FIREBASE_CONFIG.apiKey !== "PASTE_ME";

  // --- Local-only fallback (Firebase not set up yet) -----------------------
  if (!configured || typeof firebase === "undefined") {
    window.plannerStore = {
      configured: false,
      canEdit: () => true, // solo/local mode — you can always edit your own copy
      init: async () => {},
      subscribe: () => {},
      writeDay: () => {},
      writeFuture: () => {},
      writeStats: () => {},
      writeAgenda: () => {},
      getAudit: async () => null,
      onAuthChange: () => {},
      signIn: () => {},
      signOut: () => {},
      user: () => null,
    };
    return;
  }

  firebase.initializeApp(FIREBASE_CONFIG);
  const db = firebase.firestore();
  const auth = firebase.auth();

  let currentUser = null;
  const authCbs = [];
  const ownerSet = typeof OWNER_UID === "string" && OWNER_UID !== "PASTE_ME";

  // Before OWNER_UID is filled in, allow the first signed-in user to edit so
  // you can do initial setup. After you set OWNER_UID, only that account edits.
  const canEdit = () =>
    !!currentUser && (!ownerSet || currentUser.uid === OWNER_UID);

  auth.onAuthStateChanged((u) => {
    currentUser = u;
    authCbs.forEach((cb) => {
      try { cb(); } catch (e) { console.error(e); }
    });
  });

  // --- Pull the cloud data down into localStorage --------------------------
  async function hydrate() {
    try {
      const snap = await db.collection("days").get();
      snap.forEach((doc) => {
        localStorage.setItem(DRAFT_PREFIX + doc.id, JSON.stringify(doc.data()));
      });
      const fut = await db.collection("meta").doc("future").get();
      if (fut.exists && Array.isArray(fut.data().rows)) {
        localStorage.setItem(FUTURE_KEY, JSON.stringify(fut.data().rows));
      }
      const ag = await db.collection("meta").doc("tlagenda").get();
      if (ag.exists && Array.isArray(ag.data().rows)) {
        localStorage.setItem(AGENDA_KEY, JSON.stringify(ag.data().rows));
      }
      const st = await db.collection("meta").doc("stats").get();
      if (st.exists && st.data().counts) {
        localStorage.setItem(STATS_KEY, JSON.stringify(st.data().counts));
      }
      // Daily inbox size at ~5 PM, written by the PlannerAudit generator.
      const ib = await db.collection("meta").doc("inbox").get();
      if (ib.exists && ib.data().counts) {
        localStorage.setItem(INBOX_KEY, JSON.stringify(ib.data().counts));
      }
    } catch (e) {
      console.error("Firestore hydrate failed; using local cache.", e);
    }
  }

  // Wait for the first auth result (so canEdit() is accurate), then hydrate.
  async function init() {
    await new Promise((resolve) => {
      const off = auth.onAuthStateChanged(() => {
        off();
        resolve();
      });
    });
    await hydrate();
  }

  // --- Writes (owner only) -------------------------------------------------
  const timers = {};
  function debounce(key, fn) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(fn, 600);
  }

  function writeDay(dayKey, obj) {
    if (!canEdit()) return;
    debounce("day:" + dayKey, () =>
      db.collection("days").doc(dayKey).set(obj).catch(console.error)
    );
  }
  function writeFuture(rows) {
    if (!canEdit()) return;
    debounce("future", () =>
      db.collection("meta").doc("future").set({ rows }).catch(console.error)
    );
  }
  function writeStats(counts) {
    if (!canEdit()) return;
    debounce("stats", () =>
      db.collection("meta").doc("stats").set({ counts }).catch(console.error)
    );
  }
  function writeAgenda(rows) {
    if (!canEdit()) return;
    debounce("agenda", () =>
      db.collection("meta").doc("tlagenda").set({ rows }).catch(console.error)
    );
  }

  // --- Daily audits (read-only; owner-gated by Firestore rules) ------------
  // The `audit/<YYYY-MM-DD>` docs hold TEAL + Claude Code activity written by
  // the local PlannerAudit generator. Firestore rules restrict READ to the
  // owner, so a denied read (viewer / not signed in) simply resolves to null
  // and the tables show an empty state — no sensitive data reaches viewers.
  async function getAudit(dayKey) {
    try {
      const doc = await db.collection("audit").doc(dayKey).get();
      return doc.exists ? doc.data() : null;
    } catch (e) {
      return null; // permission-denied (not owner) or offline
    }
  }

  // --- Live updates for viewers -------------------------------------------
  // Only viewers subscribe. The owner is the sole writer and already holds the
  // latest state locally, so re-rendering on every echoed write would just
  // interrupt typing. Call subscribe() again after any auth change: it starts
  // listeners for a viewer and tears them down if the owner signs in.
  let unsubFns = [];
  function subscribe(onChange) {
    if (canEdit()) {
      unsubFns.forEach((f) => f());
      unsubFns = [];
      return;
    }
    if (unsubFns.length) return; // already listening

    unsubFns.push(
      db.collection("days").onSnapshot((snap) => {
        let changed = false;
        snap.docChanges().forEach((ch) => {
          localStorage.setItem(
            DRAFT_PREFIX + ch.doc.id,
            JSON.stringify(ch.doc.data())
          );
          changed = true;
        });
        if (changed) onChange();
      }, console.error)
    );
    unsubFns.push(
      db.collection("meta").doc("future").onSnapshot((doc) => {
        if (doc.exists && Array.isArray(doc.data().rows)) {
          localStorage.setItem(FUTURE_KEY, JSON.stringify(doc.data().rows));
          onChange();
        }
      }, console.error)
    );
    unsubFns.push(
      db.collection("meta").doc("tlagenda").onSnapshot((doc) => {
        if (doc.exists && Array.isArray(doc.data().rows)) {
          localStorage.setItem(AGENDA_KEY, JSON.stringify(doc.data().rows));
          onChange();
        }
      }, console.error)
    );
  }

  window.plannerStore = {
    configured: true,
    canEdit,
    init,
    hydrate,
    subscribe,
    writeDay,
    writeFuture,
    writeStats,
    writeAgenda,
    getAudit,
    onAuthChange: (cb) => authCbs.push(cb),
    signIn: () =>
      auth
        .signInWithPopup(new firebase.auth.GoogleAuthProvider())
        .catch((e) => alert("Sign-in failed: " + e.message)),
    signOut: () => auth.signOut(),
    user: () => currentUser,
  };
})();
