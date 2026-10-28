# Verified-email iPad checkout pilot

This is a one-iPad self-service checkout flow integrated with TAD Lab Manager. Eric confirmed the test device as **Student iPad #07**, university asset **1982096**. Its registration form is prefilled with that number, case label, and sticker ID `IPAD-07`; prefilling is not production registration. The printed text “PROPERTY OF THE STATE OF MINNESOTA” is ownership wording, not part of the number. Checkouts default to paused and email defaults to off.

## Student workflow

The case sticker opens `https://tad-lab-manager.web.app/equipment-checkout.html?asset=ACTUAL-STICKER-ID`. The manager screen always generates production-origin sticker URLs, even when viewed on a temporary preview. The ID is looked up against a manager-registered inventory record, never trusted as editable asset metadata. The same ID is included in the verification email's continue URL, so registration/verification does not require rescanning.

Students create an email/password account, open Firebase's verification email, and return to checkout. “I verified my email” reloads the account and refreshes its ID token. The submit function independently requires a verified token **and** a currently verified, enabled account with the same email. Merely hiding/showing the form does not authorize a loan. A verified email confirms mailbox access, not enrollment or faculty permission.

The form collects name, course/project, purpose, an automatic eight-week return/re-checkout deadline (56 days after server submission), condition/notes, accessories, and a versioned acknowledgment. Email/UID, asset metadata, and timestamps are server-derived. The acknowledgment is a pilot responsibility statement, not a substitute for an institution-approved loan agreement. The old prototype's faculty-approval stage is not part of this simplified pilot. Lab managers confirm physical returns.

## Eight-week modules

Every checkout gets a server-derived `cycleStartedAt`, `renewalDueAt` exactly 56 × 24 hours later, and a Central Time due date for the spreadsheet. Students cannot choose or extend that deadline through the form or request. Both student history and the manager's active-loan view show an icon with text: green/current, amber/final seven days, red/re-checkout required at the 56-day boundary, and neutral/closed for returned or replaced cycles. Visible status refreshes every minute. Legacy loans derive their deadline from their original checkout timestamp rather than an old editable return date.

At or after eight weeks, the current borrower can choose **Re-checkout this iPad** and complete a fresh module form with condition, accessories, and the new acknowledgment. The server requires current email verification and matching asset/borrower pointers. Early re-checkout and another borrower's attempts are rejected. A transaction closes the preceding cycle as `renewed`, creates a new loan plus permanent `renewal` event/outbox item, and starts the next 56-day period. The original event remains unchanged. No physical return is recorded unless a manager actually confirms one. Simultaneous requests and connection retries cannot create multiple new cycles.

Checkout, re-checkout, and physical return events use the configured email and spreadsheet deliveries. The status indicator itself does not send a scheduled overdue email.

## Asset-number validation

The university asset number must be a string of **exactly seven ASCII digits**. Leading zeros stay intact. Short, long, nonnumeric, signed, decimal, Unicode-lookalike, or ownership-text-inclusive entries are rejected. The form provides a live count and clear error before submission. It permits a long paste to remain visible so an eight-digit value is rejected instead of silently truncating to a valid seven-digit prefix. The seven-digit rule is fixed in the backend, not inferred from the input or controlled by a request parameter.

Manager registration, pilot enablement, and the checkout transaction enforce this rule. The borrower form uses the registered number and cannot override it; an invalid stored number disables the checkout button and is rejected by a direct backend call too. This validation is for the university asset number, distinct from a case label (`Student iPad #07`) or QR sticker ID (`IPAD-07`).

## Data and access

The existing `(default)` Firestore database and its current document API are used. No database, auth provider, or existing maintenance rules are replaced. All new checkout paths remain covered by the existing default-deny rules. The browser uses authenticated, App Check enforced callable functions; the Admin SDK performs validated transactions. Verified managers are the same four emails used by the existing app.

- `checkoutConfig/pilot`: private routing, sheet ID, enabled flag, one pilot asset ID.
- `checkoutAssets/{assetId}`: registered metadata and current loan pointer; contains no borrower identity.
- `checkoutProfiles/{uid}`: private name/email autofill, written by the server.
- `checkoutBorrowers/{uid}`: current loan pointer.
- `checkoutLoans/{loanId}`: current loan state and immutable original checkout fields. Manager returns and borrower re-checkouts update closure fields; original checkout fields remain unchanged.
- `checkoutEvents/{eventId}`: permanent append-only checkout/re-checkout/return snapshots. No callable edits or deletes events.
- `checkoutOutbox/{eventId}`: private delivery progress, bounded retries, and per-event leases.
- `checkoutCounters/history`, `checkoutDaily/{date}`, `checkoutDeliveryBudgets/{date}`: transactional sequence and daily limits.

Client reads/writes to every new path, including staff client SDK requests, remain denied. Students can retrieve only their own loans through `checkoutSession`. Managers can retrieve up to the newest 500 events and export a spreadsheet-safe CSV. Older events stay in the database. Direct SDK bypass/PII access, role injection, and history alteration are tested against the Firestore emulator.

A checkout transaction creates the loan, history event, outbox item, profile, sequence, and availability pointers together. A deterministic UID/request ID makes connection retries idempotent. Concurrent students cannot acquire the same iPad. Returns create a second event and release the asset; the original event remains unchanged. The one-iPad pilot allows only one active loan per borrower.

## Delivery setup

The manager screen has a dedicated Google spreadsheet destination and three email modes: off, pilot (Eric only), and all four stakeholders (Nick Lowery, Andrew Graham, Eric Carlson, Chase Cornell). No student can select recipients. Pilot email mode is intended for the first real receipt test; switching to stakeholder mode affects future/not-yet-delivered notices, and does not resend completed pilot notices.

Share a dedicated spreadsheet, restricted to lab managers, as Editor with `tad-lab-manager@appspot.gserviceaccount.com`. App manager permissions do not automatically grant Google spreadsheet access; give each intended manager access to the spreadsheet separately. The Google Sheets API must be enabled on the Firebase project's underlying Google Cloud project. The functions explicitly run as this service account; if a different runtime account is needed, change both backend options and the displayed sharing instructions together.

The writer creates a separate `TAD checkout log` tab with an app ownership marker. It refuses to overwrite a pre-existing unmarked tab with that name. Event sequence determines a fixed row, so a retry updates that event's row instead of appending another copy. Values use RAW input so student text cannot execute as sheet formulas. Do not edit/sort/delete rows in the managed tab; use a separate sheet/view for sorting. Firestore remains authoritative. Once set, the destination cannot be changed from the pilot screen.

Gmail SMTP uses the existing `GMAIL_SMTP_USER` and `GMAIL_APP_PASSWORD` Firebase secrets. Their actual availability and BSU receipt must be verified in the deployed environment. The sender is authenticated Gmail, not a spoofed BSU address. Reply-To is Eric's BSU address. Auth verification/reset mail is sent independently by Firebase Auth; Gmail SMTP is for checkout notifications.

An outbox worker attempts configured deliveries after a saved event. Scheduled retries run every 30 minutes, up to ten attempts; managers can manually retry pending items after fixing configuration or reaching a daily limit. Each component records its own success. Sheet errors or SMTP errors do not undo a checkout. SMTP is at-least-once: a crash after SMTP acceptance but before saving success, or partial recipient rejection, can still cause duplicate notices on retry. A deterministic Message-ID and the event ID help identify duplicates; exactly-once SMTP delivery is not claimed.

Limits are 100 successful checkouts/day and 100 checkout-email recipient attempts/day (four stakeholders consume four). Each function has zero minimum and one maximum instance. These are application controls, not a guarantee of a maximum Google Cloud bill. Other app services have their own usage. Configure project budget alerts and appropriate service spend controls separately.

## Deployment and first physical test

The new backend is a separate `equipment-checkout` codebase in `checkout-functions/`. The existing `functions/` codebase and draft maintenance email implementation are unchanged.

1. In an authenticated Firebase environment, confirm `tad-lab-manager` billing and inspect the existing `(default)` database edition/location. The workstation used for initial development had no authenticated Firebase CLI session; it could not inspect live billing or deploy functions.
2. Install `npm ci --prefix checkout-functions`. Check the Gmail secrets exist and the runtime service account has Firestore and secret access. Enable the Google Sheets API. Do not put secret values in files or GitHub source.
3. Deploy only the pilot codebase: `npx firebase-tools@latest deploy --only functions:equipment-checkout --project tad-lab-manager`. This includes the scheduled retry worker and may require the normal Functions/Eventarc/Scheduler IAM setup. Do not deploy the unrelated default codebase.
4. Deploy the reviewed hosting changes through the existing main-branch hosting workflow. Check Firebase Auth authorized domains and the verification email template's action handler. Production continuation must retain the asset parameter. Preview hosting domains need their own Auth/reCAPTCHA authorization for real account tests.
5. Sign in as a verified manager. Review the prefilled Student iPad #07 / asset 1982096 against the physical label and register it; this produces the sticker destination. Registration keeps checkouts paused and email off. No demo inventory is seeded in production.
6. Configure and share the actual spreadsheet, select Eric-only pilot email, and enable the pilot. Print one QR sticker for the confirmed asset URL.
7. On a phone, scan the sticker, create a new account, verify actual inbox receipt, follow the verification link, and return to checkout. Attempt checkout before verifying too: it must fail. Confirm autofill and the retained asset after verification.
8. Submit one checkout and confirm the manager history, spreadsheet row, and actual email receipt. Refresh/retry the request to confirm only one loan exists. A second borrower must be blocked while it is out.
9. A manager confirms return. Confirm a separate return event/row/email and restored availability. Then select all four stakeholders and verify routing before student rollout.

Production registration of the confirmed asset, a real spreadsheet destination, live backend deployment, Auth/App Check live verification, and actual email/spreadsheet receipt are still required to complete the physical pilot. No real email receipt or sheet write is claimed by emulator tests.

## Automated verification

Install `npm ci --prefix tests` and `npm ci --prefix checkout-functions`, then run:

```sh
npx firebase-tools@latest emulators:exec --only firestore --project demo-tad-checkout "npm --prefix checkout-functions test && npm --prefix tests test"
node --test scripts/canonical-redirect.test.mjs
```

Use Java 21 with current Firebase Tools. Local initial verification also passed with Firebase Tools 14.15.2/Firestore emulator 1.19.8 and Java 17. Production runtime is Node 22; the initial workstation used Node 24 for local tests.

For local browser testing only, `firebase.checkout-emulator.json` runs Auth, Firestore, Functions and Hosting against the `demo-tad-checkout` project. Add ignored `checkout-functions/.secret.local` dummy SMTP values if the emulator requests them. The browser connects to emulators only on `localhost`/`127.0.0.1` with `?emulator=1`; production hosts cannot opt into emulator mode. The delivery worker refuses all external email/sheet operations in emulator mode.

The browser smoke test (`scripts/checkout-browser-smoke.cjs`) uses actual Auth and Firestore emulators, actual email action codes, and a local HTTP callable adapter to the real service. It covers signup, the verification gate, asset retention, autofilled email, checkout, manager history, confirmed return, clearing private data on sign-out, and narrow-screen layout. It does not test deployed Cloud Functions IAM/App Check enforcement or real email/Sheets delivery. The adapter avoids the workstation's restriction on the Functions emulator's Unix sockets.

```sh
npm install --prefix .local --no-save playwright
# Install that Playwright version's Chromium using its CLI, then:
npx firebase-tools@latest emulators:exec --config firebase.checkout-emulator.json --project demo-tad-checkout --only auth,firestore,hosting "node scripts/checkout-browser-smoke.cjs"
```

`TAD_CHECKOUT_CHROMIUM` can select an already-installed Chromium executable. Work Mode can also use its runtime Playwright package. All fixtures and screenshots are local to the emulator test; they are not production asset registrations.

## Live deployment status (October 28, 2026)

The eight-week update was published to the PR hosting preview. All 32 service/delivery/time-boundary tests passed locally and in GitHub CI, along with the existing access-control checks. The Auth/Firestore emulator browser test passed the 56-day red status, a fresh module re-checkout, manager status, and a physical return. These checks do not establish live Gmail or Sheets delivery.

After the owner updated the GitHub deployment account roles, inspection of the existing default database succeeded: Firestore Native, Standard edition, `us-central1`. Backend deployment then stopped before making changes because the deployer lacks `iam.serviceAccounts.actAs` on `tad-lab-manager@appspot.gserviceaccount.com`. The GitHub principal is `github-action-tad-lab-manager@tad-lab-manager.iam.gserviceaccount.com`; it needs the **Service Account User** role (`roles/iam.serviceAccountUser`) on that runtime service account. This grant lets the deployer assign the runtime identity; it does not confer app manager permissions on students. No IAM changes were made by this implementation.

Blocked attempt: https://github.com/theeray/TAD-Lab-Manager/actions/runs/40748226492 . Once that grant is saved, rerun the failed deployment job. The workflow also supports manual dispatch and backend changes on this specific `feature/verified-ipad-checkout` PR branch. It tests access controls, inspects only the known default database, and deploys only the equipment-checkout codebase plus the unchanged access rules. Other PR branches cannot trigger backend deployment.

The pilot functions and production hosting update are not live yet. Runtime/secrets/API setup, production asset registration, restricted spreadsheet sharing, deployed Auth/App Check validation, and actual email/spreadsheet receipt still need the live pilot checks above. Main remains unchanged.
