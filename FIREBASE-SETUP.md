# TAD Lab Manager — Firebase Spark Setup

This release is intentionally designed for **Firebase Spark / no billing account**. It does not require Cloud Functions, Firebase Storage, or the Trigger Email extension.

## 1. Create or choose a Firebase project

Use a dedicated Firebase project for TAD Lab Manager if possible.

In Firebase Console:

1. Add/register a **Web App**.
2. Copy the Web App configuration object.
3. Paste the values into `firebase-config.js`.

Official setup:
https://firebase.google.com/docs/web/setup

The site uses Firebase browser/CDN modules and can remain a simple GitHub Pages site without a Node build process.

## 2. Create Cloud Firestore

Create the default Cloud Firestore database.

The app uses these collections:

- `machines` — equipment, location, purchase information, status, tutorial category
- `reports` — student-submitted maintenance/problem reports
- `repairs` — repair notes, parts/service costs, labor, and downtime

No photos are stored by this release.

Firestore's no-cost quota is suitable for initial TAD Lab Manager use. Monitor usage under the Firestore Usage page.

Official quotas:
https://firebase.google.com/docs/firestore/quotas

## 3. Enable Firebase Authentication

In **Authentication > Sign-in method**, enable:

- **Anonymous** — students can submit a report without creating an account
- **Microsoft** — BSU staff use Microsoft 365 / Azure AD to access staff-only records and administration

The supplied Firestore rules treat a Microsoft-authenticated account ending in `@bemidjistate.edu` as staff.

Microsoft sign-in requires an Azure/Microsoft OAuth Client ID and Client Secret. Register the Firebase redirect URI in the Microsoft identity platform.

Official Microsoft OAuth instructions:
https://firebase.google.com/docs/auth/web/microsoft-oauth

## 4. Deploy the Firestore Security Rules

The included `firestore.rules`:

- requires authentication before reading machine records
- allows authenticated students to create reports only
- checks that the selected machine exists
- restricts urgency and usability values
- limits text-field sizes
- requires server-generated submission time
- prevents students from reading the report collection
- reserves machine/report/repair management for BSU Microsoft-authenticated staff
- denies all unspecified collections by default

You can paste the rules into **Firestore > Rules**, or deploy them with the Firebase CLI.

Official rules documentation:
https://firebase.google.com/docs/firestore/security/get-started

## 5. Configure Firebase App Check before public launch

App Check adds an important anti-abuse layer to the public reporting workflow.

This project is already coded to initialize App Check using **reCAPTCHA Enterprise** when a valid site key is present.

### Create the key

1. In Google Cloud Console for the same Firebase project, create a **score-based reCAPTCHA Enterprise Web key**.
2. Add the deployed TAD Lab Manager domain (for example, your GitHub Pages domain).
3. Do not add `localhost` to the production key.
4. In Firebase Console, open **App Check** and register the web app using that key.
5. Paste the key into:

`firebase-config.js`

```js
export const appCheckConfig = {
  recaptchaEnterpriseSiteKey: "YOUR_SITE_KEY"
};
```

Firebase supports App Check with reCAPTCHA Enterprise on the Spark plan. The default risk threshold is a reasonable starting point.

Official instructions:
https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider

### Do not enable enforcement immediately

First deploy the app with App Check configured and use the App Check metrics to confirm that normal BSU/student traffic is receiving valid tokens.

After testing:

1. Open Firebase Console > App Check.
2. Enable enforcement for **Cloud Firestore**.
3. Consider Authentication enforcement only after testing the login/report flow carefully.

App Check helps reduce abuse, but it should be combined with the included Authentication and Firestore Security Rules.

## 6. Seed the first machine records

After Firebase is connected:

1. Open TAD Lab Manager.
2. Click **Staff sign in** and use a BSU Microsoft 365 account.
3. Open **Settings**.
4. Click **Add starter machine records**.
5. Edit those records and add the remaining physical machines.

Each machine has a **Tutorial / equipment set**. A machine automatically displays tutorials assigned to that category.

Tutorials can now have both a primary and secondary equipment category, so shared workflows (for example Graphtec + Flat Heat Press) can appear under both.

## 7. Deploy to GitHub Pages

Upload the contents of this folder to the GitHub Pages repository.

After the final URL is known, each machine's **Copy Maintenance Link** button creates a link such as:

`https://YOUR-SITE.example/?machine=cnc-shopbot-01#report`

Put that URL behind the **Report a Problem / Maintenance** button in the machine's existing Linktree.

The existing physical QR stickers can remain in place because the QR still opens the Linktree; only the Linktree destination changes.

## 8. Email notifications are deferred

This release does not deploy Cloud Functions and does not require Blaze.

New reports:

1. save directly to Firestore;
2. appear in the staff dashboard;
3. remain part of the machine's maintenance history.

If BSU later approves an institution-owned notification service, automatic email can be added as a separate backend layer without changing the report structure.

This avoids requiring a personal credit card or open-ended pay-as-you-go billing for the initial production deployment.

## 9. Data export and long-term records

Staff can download:

- Reports CSV
- Machines CSV
- Repairs CSV
- Full JSON backup

CSV files open directly in Excel. These exports provide a human-readable archive in addition to the live Firestore records.

## Tutorial migration in this release

The tutorial library contains **235 direct tutorials**:

- 175 previously approved tutorials
- 60 additional tutorials approved in the 77-item review workbook

Review outcome for the 77 flagged items:

- 60 included
- 16 left out
- 1 held until revised: `Finger Joint Box Tutorial (unfinished)`

The nine tutorials assigned to two equipment categories are stored with primary and secondary machine/category mappings and appear under either category in the app.
