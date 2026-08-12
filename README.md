# TAD Lab Manager — First Generation Prototype

A GitHub Pages-ready prototype inspired by the existing **3d Print Lab TD** Power Automate flow.

## What works now

- Student-facing machine problem report form
- Machine-specific links for QR codes: `?machine=machine-id#report`
- Power Automate fields preserved: urgency, issue, machine, fixes attempted, preferred contact, resource
- Photo input available for workflow testing, but photos are **not stored**
- Per-machine stakeholder routing and notification preview
- Persistent browser-based test records using `localStorage`
- Issue dashboard and report status workflow
- Machine inventory
- Repair, parts/service cost, labor, and downtime records
- CSV exports for Reports, Machines, and Repairs
- Full JSON backup/restore
- Responsive layout for phones/tablets/desktops

## Important prototype limitation

This version intentionally does **not** use a backend. Data is stored only in the current browser/device. It is ideal for workflow/UI testing, but not yet appropriate for live institutional use.

## Next production phase

1. Replace `localStorage` with Firebase Firestore.
2. Add staff/admin authentication and Firestore security rules.
3. Add secure backend notification delivery (email).
4. Decide how temporary problem photos should be transmitted and discarded.
5. Add true XLSX workbook export if desired.
6. Generate/print QR codes for all machines.
7. Apply final TAD / Bemidji State branding.

## Test locally

You can open `index.html` directly, but running a simple local server is more reliable:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## GitHub Pages

Upload the contents of this folder to a GitHub repository and enable Pages from the repository's main branch/root. No build process is required.

## QR-link example

If the site becomes:

`https://example.github.io/tad-lab-manager/`

then a machine QR can point to:

`https://example.github.io/tad-lab-manager/?machine=laser-epilog-fusion-01#report`

That link opens the report page with the machine already selected.
