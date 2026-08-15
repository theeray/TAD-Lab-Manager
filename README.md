# TAD Lab Manager — Spark v1.2

TAD Lab Manager is the shared web hub for the School of Technology, Art & Design labs at Bemidji State University.

## Main modules

- **Cost Estimator** — `projects/index.html`
  - Student-facing project budgeting and pricing simulation.
  - Estimates remain private to the student's browser in this release.
- **Machines & Maintenance** — `maintenance/index.html`
  - Firebase/Firestore-backed machine issue reporting, staff dashboard, machine records, repair costs, downtime, and exports.
- **Tutorials & Safety** — `tutorials.html`
  - 235 directly linked iorad/video/web tutorials with machine/category mappings.
- **Permanent machine pages** — `machine.html?id=<stable-id>`
  - Stable machine pages for tutorials, manufacturer information, manuals, maintenance reporting, and Linktree/QR workflows.

## Visual design

This build restores the approved TAD Lab Manager visual baseline:
- supplied square T logo for navigation
- supplied horizontal TAD logo on the home hero
- Century Gothic / Futura-family typography
- yellow Cost Estimator, blue Machines & Maintenance, and red Tutorials modules
- six-color TAD stripe
- lab-location color badges
- mobile-friendly layouts

## Firebase / no-billing architecture

The maintenance system is designed to launch on Firebase **Spark**:
- Cloud Firestore for machines, reports, repairs, costs, and downtime
- Anonymous Authentication for student reporting
- Microsoft Authentication for authorized `@bemidjistate.edu` staff
- Firebase App Check preparation for abuse protection
- strict Firestore Security Rules

This release intentionally does **not** include Cloud Functions, Trigger Email, Firebase Storage, or automatic stakeholder email. Those can be evaluated later under an institution-owned service if desired.

## Tutorials

`data/tutorials.json` contains **235 approved tutorials**:
- 175 from the initial migration
- 60 additionally approved from the 77-item review queue
- 16 left out
- 1 held until revised (`Finger Joint Box Tutorial (unfinished)`)

`Kinetic sculpture` is mapped to **ShopBot CNC Router**.

## Machines

`data/machines.json` contains the 40-machine inventory used by the branded home page and the Firebase seed function. Stable machine IDs are used for maintenance links.

A maintenance URL has this form:

`https://YOUR-GITHUB-PAGES-URL/maintenance/index.html?machine=MACHINE-ID#report`

Existing physical QR codes can remain on the machines if they already open Linktrees. Update the **Report a Problem** Linktree button to the machine-specific URL above.

## Hosting

Upload the contents of this folder to the root of the GitHub Pages repository. Keep:
- `data/tutorials.json`
- `data/machines.json`

inside the `data` folder.

See `FIREBASE-SETUP.md` before public launch.
