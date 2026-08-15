# TAD Lab Manager — Firebase Spark Setup

This build is designed to launch without a billing account.

## 1. Create a Firebase project and Web App

In Firebase Console, create or choose the TAD Lab Manager project and register a **Web App**.

Copy the Firebase Web App configuration values into the root file:

`firebase-config.js`

Do not move `firebase-config.js` into the `maintenance` folder; the maintenance module imports the shared root configuration.

## 2. Create Cloud Firestore

Create the default Cloud Firestore database in Native mode.

Collections used by this release:
- `machines`
- `reports`
- `repairs`

No `mail`, `routing`, photo-storage, or Cloud Functions collection/service is required.

## 3. Enable Authentication

Enable:
- **Anonymous** sign-in for student maintenance submissions
- **Microsoft** sign-in for staff administration

The included Firestore rules limit staff access to Microsoft-authenticated email addresses ending in `@bemidjistate.edu`.

Microsoft sign-in requires a Microsoft/Azure OAuth client configuration and Firebase's redirect URI to be registered with Microsoft.

## 4. Publish the Firestore rules

Use the included root file:

`firestore.rules`

The rules allow:
- authenticated users to read machine records
- anonymous/authenticated students to create tightly validated reports
- only Microsoft-authenticated BSU staff to read or change maintenance reports
- only BSU staff to manage machine and repair records

## 5. Configure App Check before public launch

Create a reCAPTCHA Enterprise web key for the deployed GitHub Pages domain.

Paste the site key into:

`firebase-config.js`

Then register the web app under Firebase **App Check**. Test normal student and staff use first; after validation, enable enforcement for Firestore.

## 6. Seed the machine inventory

After Firebase is connected:

1. Open `maintenance/index.html`.
2. Sign in as staff with Microsoft 365.
3. Open **Settings**.
4. Click **Add starter machine records**.

The seed contains the same 40-machine inventory used by the branded home page.

## 7. GitHub Pages

Upload this entire folder structure to the repository root.

Important paths:
- `/index.html`
- `/maintenance/index.html`
- `/data/tutorials.json`
- `/data/machines.json`
- `/firebase-config.js`

In GitHub Pages, publish from the `main` branch and repository root.

Add the final GitHub Pages domain to Firebase Authentication's authorized domains.

## 8. Linktree maintenance URLs

Each machine gets a URL like:

`https://YOUR-GITHUB-PAGES-URL/maintenance/index.html?machine=cnc-shopbot-full-01#report`

Use that as the machine's **Report a Problem** Linktree destination. The physical QR sticker can remain unchanged if it already points to the Linktree.

See `LINKTREE-MAINTENANCE-LINKS.csv` for the complete 40-machine list after replacing the placeholder domain.

## No Blaze requirement in this release

This release contains no Cloud Functions or automatic email delivery, so it is designed to run on Firebase Spark with no billing account attached.
