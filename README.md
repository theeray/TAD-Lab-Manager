# TAD Lab Manager

TAD Lab Manager is a browser-based lab operations system for machine tutorials, student problem reporting, maintenance history, repair costs, downtime, schedules, and spreadsheet exports.

## This release

This release is designed to run on the **Firebase Spark (no-cost) plan** without a billing account, Cloud Functions, Firebase Storage, or permanent photo storage.

Included:

- Cloud Firestore shared data for machines, reports, repairs, costs, and downtime
- anonymous student reporting
- BSU Microsoft 365 staff authentication
- Firebase App Check integration using reCAPTCHA Enterprise (site key setup required before public launch)
- stricter Firestore Security Rules and field-size validation
- machine-specific maintenance URLs for existing Linktrees / QR codes
- direct tutorial library with **235 approved tutorials**
- dual-machine tutorial mapping where appropriate
- ShopBot mapping for the Kinetic Sculpture tutorial
- Lab Corps Worker Schedule
- Digital Corps Worker Schedule
- issue dashboard and status workflow
- repair / parts / service cost / labor / downtime records
- CSV downloads for Excel
- JSON backup

## Notifications

Reports are stored immediately in the shared Firestore database and appear on the staff dashboard.

**Automatic email notification is intentionally not enabled in this Spark-plan release.** It can be added later using an institution-owned server-side service (for example, an IT-approved Microsoft/Azure or Firebase backend) without changing the core reporting database.

## Tutorial migration

The app now contains:

- 175 tutorials previously approved for direct inclusion
- 60 additional tutorials approved in `TAD_Tutorial_77_Review_Queue(1).xlsx`
- **235 tutorials total**

The review decisions leave out 16 tutorials and hold 1 unfinished tutorial for later revision. See `TUTORIAL-MIGRATION-SUMMARY.md`.

## Firebase activation

The site cannot use shared records until its Firebase Web App configuration is supplied.

1. Create/register the Firebase Web App.
2. Paste its configuration into `firebase-config.js`.
3. Create Firestore.
4. Enable Anonymous and Microsoft Authentication.
5. Deploy/paste `firestore.rules`.
6. Configure Firebase App Check before public launch.
7. Seed the starter machines from Settings.

See `FIREBASE-SETUP.md`.

## Main files

- `index.html` — app shell and pages
- `styles.css` — interface styles
- `app.js` — application logic, Firestore, Authentication, and App Check integration
- `firebase-config.js` — Firebase Web App + App Check site-key placeholders
- `firestore.rules` — access control and report validation
- `data/tutorials.json` — 235 approved direct tutorials
- `LINKTREE-MAINTENANCE-LINKS.csv` — starter machine-specific link patterns
- `FIREBASE-SETUP.md` — deployment instructions
- `TUTORIAL-MIGRATION-SUMMARY.md` — tutorial review/migration record
