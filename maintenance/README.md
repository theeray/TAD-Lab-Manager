# Machines & Maintenance

This module is the shared maintenance and equipment-record portion of TAD Lab Manager.

## Student workflow

1. Scan the existing machine QR code.
2. Open that machine's Linktree.
3. Choose **Report a Problem**.
4. The machine-specific TAD Lab Manager link opens the same maintenance form with the machine preselected.
5. Submit urgency, usability, issue description, fixes attempted, preferred contact, and an optional resource link.

The report is stored in Cloud Firestore.

## Staff workflow

Authorized Bemidji State staff can sign in with Microsoft 365 to:
- review open and historical reports
- change issue status
- record repairs
- record parts and service costs
- record downtime
- manage machine records
- copy machine-specific maintenance links
- export reports, machines, and repair records as CSV
- download a full JSON backup

## Notifications

Automatic outgoing email is intentionally disabled in this Spark/no-billing release. The operational dashboard is the source for new and unresolved maintenance reports.

## Tutorials

The reporting screen automatically surfaces direct tutorials mapped to the selected machine. The module also contains a searchable 235-tutorial view.
