# TAD Project Cost Estimator

The Cost Estimator converts the TAD costing-sheet workflow into a browser-based student tool.

## Current behavior

- Estimate materials, quantities, production processes, and finishing.
- Preserve the intended spreadsheet pricing logic used by the prior costing workflow.
- Save estimates locally in the student's browser.
- Export/import local estimate data as JSON.
- Edit demo pricing values for testing and course use.

The pricing table should be reviewed before using totals operationally because the original workbook depended on an external master-price source that was not embedded in the workbook.

This module is intentionally local to the browser; the shared Firebase database is used by Machines & Maintenance, not student project estimates.
