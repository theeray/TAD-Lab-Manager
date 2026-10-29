# TAD iPad checkout beta - in-app records

The beta uses **Student iPad #07**, university asset **1982096**, and sticker ID **IPAD-07**. The permanent QR destination is:

`https://tad-lab-manager.web.app/equipment-checkout.html?asset=IPAD-07`

The manager registration form is prefilled with those values. Registration is still a verified manager action and leaves checkout paused. No fictional inventory or student accounts are seeded in production. The printed ownership phrase “PROPERTY OF THE STATE OF MINNESOTA” is separate from the seven-digit asset number.

## Records and manager interface

Firestore in the existing `tad-lab-manager` project is the authoritative record store. There is **no Google Sheets connection**, spreadsheet sharing requirement, or Sheets API call. Legacy spreadsheet configuration is ignored. The Google authentication library remains a dependency for read-only deployment diagnostics, not spreadsheet synchronization.

Verified managers can search by borrower name/email, asset number/ID, course, or purpose; filter by event, current loan status, and Central Time recorded-date range; and sort newest/oldest first. History loads in pages of 100 records. **Load older records** makes older history accessible without a separate spreadsheet. The result count explicitly states how many records are loaded and whether older records remain. Search, filters, and CSV export apply to the loaded history. A fresh refresh loads the newest page again.

CSV export includes the matching loaded events, with protection against spreadsheet formula injection. Older records are not deleted. Current active loans are read separately from asset pointers, so their eight-week indicators remain available even when their original checkout event is outside the initial history page.

## Student workflow and eight-week modules

Students scan the case QR, create an email/password account or sign in, open Firebase's verification email, and return to checkout. The selected asset ID is retained in the verification continue URL, so rescanning is not required. The backend independently requires a verified token and a currently verified, enabled account with the same email; verifying an email confirms mailbox access, not enrollment.

The form collects name, course/project, purpose, condition/notes, accessories, and a versioned responsibility acknowledgment. Trusted inventory metadata, user identity, and timestamps come from the backend. University asset numbers must contain exactly **seven ASCII digits**, preserving leading zeros. Registration, enabling checkout, and checkout submission enforce that rule. A long paste is rejected rather than silently truncated.

Every checkout has a server-derived `cycleStartedAt` and `renewalDueAt` exactly 56 x 24 hours later. A student cannot edit or forge the deadline. Student history and the manager's active-loan view show green/current, amber/final seven days, red/re-checkout required at 56 days, and neutral/closed for returned or replaced cycles. Visible indicators update every minute without a scheduled backend job. Legacy loans derive their deadline from the original checkout timestamp.

At or after eight weeks, the current borrower can choose **Re-checkout this iPad** and complete a fresh module form. The transaction requires current email verification and matching asset/borrower pointers, closes the previous cycle as `renewed`, creates a new loan and permanent `renewal` event, and starts the next 56-day period. Early attempts and attempts by another borrower are denied. Original events are unchanged. A physical return is recorded only when a verified manager confirms receipt.

## Access and permanent history

The existing default Firestore database is Native/Standard edition in `us-central1`. Existing maintenance data, auth providers, and maintenance access rules are unchanged. New checkout paths remain covered by the existing default-deny client rules. App Check enforced callable functions validate authorization; the Admin SDK performs the transactions. Browser clients, including staff client SDKs, cannot bypass those callables to read or change checkout records.

Managers are the existing four verified BSU addresses in `checkout-functions/service.js`. Students retrieve only their own loans. Both initial and paginated history endpoints require a verified manager. The app provides no event-edit or event-delete operation; infrastructure administrators still require appropriate operational controls, backups, retention decisions, and institutional review.

- `checkoutAssets/{assetId}`: trusted inventory and active-loan pointer, without borrower identity.
- `checkoutConfig/pilot`: pilot asset ID, enabled flag, and email mode.
- `checkoutProfiles/{uid}` and `checkoutBorrowers/{uid}`: private autofill and active-loan pointer.
- `checkoutLoans/{loanId}`: original checkout snapshot plus current closure state.
- `checkoutEvents/{eventId}`: append-only checkout, re-checkout, and return snapshots.
- `checkoutOutbox/{eventId}`: email status, bounded attempts, and delivery lease.
- History, daily checkout, and email-recipient counters enforce transactional sequencing and limits.

Checkout saves the loan, event, outbox item, profile, sequence, and active pointers atomically. UID/request ID based identifiers make connection retries idempotent. Competing borrowers and simultaneous renewals cannot create multiple active loans for the same iPad.

## Beta notifications

The default beta mode sends to **Eric Carlson and Nick Lowery only**:

- `eric.carlson.2@bemidjistate.edu`
- `nick.lowery@bemidjistate.edu`

Full rollout mode adds Chase Cornell and Andrew Graham using the existing fixed four-person staff list. Students cannot supply recipients or expand the list. Legacy `pilot` mode maps to the new two-person beta group. Registration defaults to beta routing, with checkout paused until a manager enables it.

Emails identify the iPad, asset, event, recorded time, deadline, and a link to the manager page. Borrower name, student email, course, purpose, and condition details stay behind manager sign-in. Students receive Firebase verification/reset email separately; no student checkout-receipt email is currently sent.

A Firestore event triggers the initial email attempt. Failed or unconfigured notices remain available through **Retry pending deliveries**. Deliberately turning notifications off marks the event `notifications-off`; later enabling email does not automatically send those old notices. No Scheduler job, Scheduler API, or Scheduler role is required.

A delivery failure does not undo the saved checkout. Successful email deliveries are not resent by normal retries. SMTP remains at-least-once: uncertain provider acceptance or partial recipient rejection can produce duplicates after a retry. Deterministic message IDs and event IDs help identify them; exactly-once email is not claimed.

Gmail uses `GMAIL_SMTP_USER` and `GMAIL_APP_PASSWORD` in Secret Manager, with Reply-To set to Eric's BSU address. Both secrets have enabled versions and direct Secret Accessor grants to runtime account `tad-lab-manager@appspot.gserviceaccount.com`. Their values were not retrieved during development diagnostics. Actual inbox delivery still needs a live beta test.

Limits remain 100 successful checkout cycles/day and 100 recipient email attempts/day; a beta notice consumes two recipient attempts. Functions have zero minimum and one maximum instance each. These controls do not guarantee a maximum cloud bill.

## QR artwork

`checkout/qr/IPAD-07.svg` is the exact reusable QR artwork shown in manager setup for the confirmed asset. A separate printable PDF includes the case label, number, QR, print dimensions, and first-test activation instructions. Both the raw image and the rendered PDF were decoded with an independent barcode reader to verify the exact permanent destination.

`scripts/create-ipad-beta-qr.py` reproduces the artwork using qrcode 8.2, ReportLab, and embedded DejaVu fonts. The sticker image contains no student information or sign-in credentials. Printing a sticker does not register an asset or enable checkout.

## Deployment and first live test

The backend is a separate `equipment-checkout` codebase in `checkout-functions/`. Deploy only this codebase; do not deploy the unrelated default functions implementation. The manual workflow tests access controls, reads service/secret metadata without secret values, inspects the known default database, and deploys this codebase plus unchanged access rules.

1. Confirm backend deployment, then publish the reviewed hosting changes through the existing main-branch workflow. Production registration and live Auth/App Check validation require the deployed backend. Preview hosts may also need Auth/reCAPTCHA domain authorization.
2. Sign in to the checkout page with a verified lab-manager BSU account. Register the prefilled Student iPad #07 / asset 1982096 / sticker ID IPAD-07, checking the physical label first.
3. Keep **Beta test - Eric and Nick** selected, enable checkout, and save beta settings. No Google spreadsheet setup is required.
4. Scan the QR on a phone. Create/verify an account, confirm that submitting before verification fails, then record the checkout. Verify the saved in-app row and actual Eric/Nick inbox receipt.
5. Search/filter the manager table and download matching CSV. Confirm another borrower cannot acquire the checked-out iPad. Have a manager confirm the physical return; verify the separate return row, restored availability, and email.
6. Use manual email retry if needed. Emulator tests simulate the eight-week boundary and renewal; do not alter production dates to simulate it.

Blaze, the default database, both email-secret grants, and the enabled cloud service APIs have been confirmed. The last deployment attempt reached function creation and returned 403 because the GitHub deployer lacked `iam.serviceAccounts.actAs` on `688198560205-compute@developer.gserviceaccount.com`, Google's default Compute build account. Grant that deployer **Service Account User** on that specific account if still missing. The runtime remains the App Engine account. No IAM changes were made by this implementation.

## Automated verification

All 37 backend, email, history pagination, filtering, and time-boundary checks passed locally, along with existing maintenance permission checks and 200 direct checkout SDK access-denial checks. Six canonical redirect checks passed. The browser test passed seven-digit registration validation, beta recipients/defaults, actual emulator email verification action code, retained asset, checkout, 56-day warning, fresh module re-checkout, manager search/filters/CSV, physical return, private data clearing at sign-out, and narrow-screen layout.

```sh
npm ci --prefix checkout-functions
npm ci --prefix tests
npx firebase-tools@latest emulators:exec --only firestore --project demo-tad-checkout "npm --prefix checkout-functions test && npm --prefix tests test"
node --test scripts/canonical-redirect.test.mjs
npx firebase-tools@latest emulators:exec --config firebase.checkout-emulator.json --project demo-tad-checkout --only auth,firestore,hosting "node scripts/checkout-browser-smoke.cjs"
```

Current Firebase Tools requires Java 21. Local tests also passed with Tools 14.15.2 and Java 17. The browser script uses Auth/Firestore emulators and a local adapter to the actual service because this workstation restricts the Functions emulator's Unix sockets. It does not establish production App Check, IAM, or real inbox receipt. External email is disabled in emulator delivery tests.
