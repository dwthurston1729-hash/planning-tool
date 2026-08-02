# Sharing setup (Firebase) — one-time

The planner now supports **shared saving**: your edits are stored in a small
free cloud database (Google Firebase Firestore) and are visible to anyone you
give the link to. You can edit; everyone else can **view only**.

Until you finish the steps below, the app runs in **local-only mode** (saves to
your browser only). It keeps working the whole time — nothing breaks while you
set this up.

---

## Step 1 — Create a Firebase project

1. Go to <https://console.firebase.google.com> and sign in with a Google
   account (a personal Gmail is fine).
2. Click **Add project**, give it a name (e.g. `daily-planner`), and finish.
   You can turn off Google Analytics when asked.

## Step 2 — Add a Web app and copy its config

1. On the project home, click the **`</>`** (Web) icon to "Add an app to get
   started."
2. Give it a nickname and click **Register app**. (You do **not** need Firebase
   Hosting.)
3. Firebase shows a `firebaseConfig = { ... }` snippet. Copy the object.
4. Open **`firebase-config.js`** in this folder and paste the values over the
   `PASTE_ME` placeholders in `FIREBASE_CONFIG`. Leave `OWNER_UID` as `PASTE_ME`
   for now.

## Step 3 — Turn on the database

1. In the left menu: **Build → Firestore Database → Create database**.
2. Choose a location, and start in **Production mode**.
3. Go to the **Rules** tab and replace the rules with this, then **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read: if true;
         allow write: if request.auth != null
                      && request.auth.uid == "PASTE_OWNER_UID_HERE";
       }
     }
   }
   ```

   (You'll replace `PASTE_OWNER_UID_HERE` in Step 5.)

## Step 4 — Turn on Google sign-in

1. **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Google** and save.
3. Open the **Settings → Authorized domains** tab and click **Add domain**.
   Add your GitHub Pages domain:

   ```
   dwthurston1729-hash.github.io
   ```

   (Keep `localhost` too if you want to test locally.)

## Step 5 — Commit, sign in, and lock it to you

1. Commit and push the edited `firebase-config.js` (plus the new files) so the
   live site has your config. See "Deploying" below.
2. Open your live site: `https://dwthurston1729-hash.github.io/planning-tool/`
3. Click **Sign in** (top right) and sign in with your Google account.
4. The top bar now shows `✎ Editing · <a long ID>`. That long ID is your
   **User ID (UID)**. Copy it.
5. Paste that UID into **two** places:
   - `firebase-config.js` → `OWNER_UID = "…";`
   - the Firestore **Rules** (Step 3) → replace `PASTE_OWNER_UID_HERE`, then
     **Publish** the rules again.
6. Commit and push `firebase-config.js` again.

Done. From now on:

- **You** (signed in with that Google account) can edit, and every change saves
  to the cloud automatically.
- **Anyone else** with the link sees your planner update live and cannot edit
  (they'll see a "read-only" banner).

---

## Deploying (making the link work)

This repo is served by **GitHub Pages**. To publish changes:

```
git add -A
git commit -m "Enable shared saving via Firebase"
git push
```

GitHub Pages redeploys automatically within a minute or two. If Pages isn't on
yet: on GitHub, go to **Settings → Pages**, and set **Source = Deploy from a
branch**, branch **main**, folder **/ (root)**.

> Note: this folder lives in OneDrive, which sometimes locks `.git` files mid-
> sync. If a `git` command complains about a locked file, pause OneDrive syncing
> for a moment and retry.

---

## Is it safe to commit `firebase-config.js`?

Yes. A Firebase **web** API key is not a secret — it only identifies your
project. Access is controlled by the **security rules** (Step 3), which only let
your signed-in account write. Everyone else is limited to reading.

## FAQ

- **Nothing shared yet / "local-only"?** `firebase-config.js` still has
  `PASTE_ME` values, or the Firebase scripts didn't load. Finish Steps 1–2.
- **I can't edit my own planner.** Make sure you clicked **Sign in** and that
  `OWNER_UID` matches the UID shown after sign-in.
- **Boss sees nothing.** Confirm you pushed after editing `firebase-config.js`,
  and that Firestore rules allow `read: if true`.
