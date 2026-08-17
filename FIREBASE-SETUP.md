# TAD Lab Manager — Firebase Spark Setup

This build is designed to launch without a billing account.

## 1. Create a Firebase project and Web App

In Firebase Console, create or choose the **TAD Lab Manager** project and register a Web App.

Copy the Firebase Web App configuration values into the root file:

`firebase-config.js`

Do not move `firebase-config.js` into the `maintenance` folder; the maintenance module imports the shared root configuration.

## 2. Create Cloud Firestore

Create the default Cloud Firestore database in Standard/Native mode and start in Production mode.

Collections used by this release:
- `machines`
- `reports`
- `repairs`

No `mail`, `routing`, photo-storage, or Cloud Functions collection/service is required.

## 3. Enable Authentication

Enable **Anonymous** sign-in for student maintenance submissions. Enable anonymous-account auto-cleanup if available.

Microsoft staff authentication requires a MinnState Microsoft Entra app registration. The approved staff list in both the web app and Firestore rules is currently:

- `ij8878si@minnstate.edu`
- `chase.cornell@minnstate.edu`
- `andrew.graham@minnstate.edu`
- `nick.lowery@minnstate.edu`

The Entra/Firebase Microsoft provider should be configured as single-tenant when MinnState IT provides the Application (client) ID, Directory (tenant) ID, and client secret. The Firebase redirect URI is:

`https://tad-lab-manager.firebaseapp.com/__/auth/handler`

Do not store a Microsoft client secret in GitHub.

## 4. Publish the Firestore rules

Use the included root file:

`firestore.rules`

The rules allow:
- authenticated users to read machine records
- anonymous/authenticated students to create tightly validated reports
- only the four explicitly approved Microsoft-authenticated staff accounts to read or change maintenance reports
- only those approved staff accounts to manage machine and repair records

The repository copy of `firestore.rules` is the source-of-truth version; after changes, publish the matching rules in Firebase Console.

## 5. Configure and verify App Check before enforcement

The web app uses **reCAPTCHA Enterprise** App Check. The reCAPTCHA key should be:

- Website / Web
- score-based
- allowed for `theeray.github.io`
- registered to the **TAD Lab Manager Web** Firebase app as reCAPTCHA Enterprise

The site key lives in `firebase-config.js` and is a public client-side identifier.

Before enabling Firestore enforcement:

1. Keep Firestore App Check in **Monitoring**.
2. Open TAD Lab Manager → **Machines & Maintenance → Settings**.
3. Check **Token diagnostic** under System connection.
4. Click **Run App Check diagnostic** if needed.
5. Do not enable enforcement until the diagnostic reports that a valid token was issued and Firebase App Check metrics begin showing verified requests.

The diagnostic intentionally reports only success/error information; it does not display or log the App Check token itself.

## 6. Seed the machine inventory

After Microsoft staff authentication is available:

1. Open `/maintenance/index.html`.
2. Sign in with one of the explicitly approved Microsoft 365 staff accounts.
3. Open **Settings**.
4. Click **Add starter machine records**.

The seed source is `/data/machines.json`, the same 40-machine inventory used by the branded home page. Until Firestore contains machine documents, the interface can display the local machine list, but student report creation will still be rejected by Firestore rules because a submitted machine ID must exist in the Firestore `machines` collection.

## 7. GitHub Pages

Important paths:
- `/index.html`
- `/maintenance/index.html`
- `/data/tutorials.json`
- `/data/machines.json`
- `/firebase-config.js`

GitHub Pages publishes from the `main` branch and repository root.

Add `theeray.github.io` to Firebase Authentication's authorized domains.

## 8. Linktree maintenance URLs

Each machine gets a URL like:

`https://theeray.github.io/TAD-Lab-Manager/maintenance/index.html?machine=cnc-shopbot-full-01#report`

Use that as the machine's **Report a Problem** Linktree destination. The physical QR sticker can remain unchanged if it already points to the Linktree.

See `LINKTREE-MAINTENANCE-LINKS.csv` for the complete machine list.

## No Blaze requirement in this release

This release contains no Cloud Functions or automatic email delivery, so it is designed to run on Firebase Spark with no billing account attached.
