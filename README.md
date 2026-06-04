# CertSecure Hub — Client Management Platform

**HUB CertSecure's internal operations platform** — compliance report generation, client management, Monday.com workspace integration, TrustLayer API sandbox, template generation, and compliance tracking across Evident and TrustLayer.

> **v0.60** · Hosted at [hubcertsecure.github.io/client-management-platform](https://hubcertsecure.github.io/client-management-platform) · Access restricted to authorized HUB CertSecure personnel

---

## What This Is

CertSecure Hub is a single-file web application hosted on GitHub Pages. It connects directly to compliance data synced from Evident and TrustLayer, generates reports for client meetings, manages client configuration, and provides tools for Monday.com workspace management and TrustLayer API exploration — all without a backend server.

---

## Application Modules

### 1. Report Generator
Select a client and generate compliance and engagement reports as PDFs and Excel workbooks directly in the browser.

| Report | Format | Data Source | Description |
|---|---|---|---|
| Compliance Summary | PDF | `data/` CSVs | Executive overview — compliance rate, KPIs, expiring coverage, top non-compliance reasons |
| Compliance Detail | Excel | `data/` CSVs | Full entity-level compliance data with filtering and custom fields |
| Engagement Summary | PDF | `data/` CSVs | Email engagement overview — open rates, delivery issues, activity window |
| Engagement Detail | Excel | `data/` CSVs | Entity-level engagement data — no-COI list, no-engagement list, undeliverable emails |
| Year End Review | PDF | `snapshots/` | Monthly compliance trend chart across all snapshots for a given year |
| Producer Overview | PDF | `snapshots/` | Snapshot-based summary formatted for referring producers |
| Thank You Card | PDF | `data/` CSVs | Landscape postcard with compliance hero stats and personalized message |
| HUB-Wide Annual | PDF | `snapshots/` | Combined annual review across all Evident clients — compliance, engagement, non-compliance trends |

Clients are displayed in a grid grouped by structure type (General / Subcontractors / Tenants), with **EV** (Evident) and **TL** (TrustLayer) badges indicating the data platform.

---

### 2. Block TL Manager
A dedicated management interface for TrustLayer clients using the Block Real Estate workspace. Provides party roster management, compliance status tracking, and document request tools specific to the Block Real Estate program structure.

---

### 3. Monday.com Generator
Tools for managing the HUB CertSecure Monday.com workspace:

- **Workspace Setup** — one-time tool to create all boards, groups, columns, and folder structure per the workspace specification
- **Workspace Configure** — configure workspace settings, column mappings, and automation rules
- **Client Manager** — manage client entries on the Monday.com Clients – Overview board

The Monday API token is never stored in the repo — it is entered at runtime and used only for that session.

---

### 4. Template Generator
Generates standard HUB CertSecure document templates for client onboarding, compliance communications, and program setup. Output templates follow HUB brand standards.

---

### 5. TL Sandbox (Write)
A full TrustLayer API explorer and sandbox for the DEMO client. Provides:

- **Overview** — workspace summary, KPI counts, status bar
- **Parties** (`/primary-records`) — list, create, view, and manage parties with dynamic attribute fields loaded from the workspace
- **Party Types** (`/primary-objects`) — manage party type definitions
- **Projects** (`/context-records`) — list, create, and manage projects with dynamic attribute fields
- **Project Types** (`/context-objects`) — manage project type definitions
- **Request Records** — list and manage compliance request records
- **Views** — read saved filtered views
- **Compliance Tools** — guided forms for generating certificates, assigning compliance profiles, and creating request records
- **Reference Data** — workspace attributes (Party / Project / Request), party types, project types, tags
- **Full API Explorer** — every v2 and v1 endpoint with raw request/response testing (156 endpoints total)

Token is stored in `localStorage` as `cs-tl-token-demo` and configured under Settings → APIs → TrustLayer Demo.

---

### 6. Client Manager
Add, edit, and deactivate clients. Manages `config/clients.json` — the master client list — written back to the repo via the GitHub Contents API when changes are saved.

---

## Repository Structure

```
client-management-platform/
│
├── index.html                   # The entire CertSecure Hub application (single file)
│
├── config/
│   └── clients.json             # Master client list — source of truth for the app
│
├── data/
│   ├── evident/                 # Synced Evident CSV data (updated by GitHub Actions)
│   │   ├── insureds.csv
│   │   ├── coverages.csv
│   │   ├── criteria.csv
│   │   ├── custom_properties.csv
│   │   └── engagement.csv
│   └── trustlayer/              # Synced TrustLayer CSV data (updated by GitHub Actions)
│       ├── insureds.csv
│       ├── coverages.csv
│       └── criteria.csv
│
├── snapshots/
│   └── YYYY/
│       └── YYYY-MM/             # Monthly compliance snapshots (one folder per month)
│           ├── insureds.csv
│           ├── criteria.csv
│           └── engagement.csv
│
├── evident-sync/
│   └── src/                     # Python sync scripts for Evident data
│
├── trustlayer-sync/
│   └── src/                     # Python/Node sync scripts for TrustLayer data
│
├── .github/
│   └── workflows/
│       └── sync.yml             # GitHub Actions workflow — triggers data refresh
│
└── README.md                    # This file
```

---

## Architecture Overview

```
Evident API  ──────┐
                   ├──► GitHub Actions (sync.yml) ──► data/ CSVs ──► CertSecure Hub
TrustLayer API ────┘                                                        │
                                                                            │
                                                              config/clients.json
                                                                            │
                                                              snapshots/ (monthly)
```

The app has no backend. Everything runs in the browser:

1. **Data lives in this repo** as CSV files, updated automatically by GitHub Actions
2. **The app fetches CSVs** directly from the GitHub Contents API at runtime
3. **Reports are generated client-side** using ExcelJS (Excel) and the browser's print dialog (PDF)
4. **Auth is handled by Supabase** — roles and sessions are stored there, not in this repo
5. **Client config is stored in `config/clients.json`** and written back to the repo via the GitHub Contents API when changes are saved in the app

---

## Data Architecture

### Evident Clients
Data is fetched from `data/evident/` using the GitHub Contents API. The `client` column in each CSV must exactly match the `client_name` field in `config/clients.json`.

| File | Contents |
|---|---|
| `insureds.csv` | One row per entity — name, email, compliance status, active/paused flags |
| `coverages.csv` | One row per coverage line — type, expiration date |
| `criteria.csv` | One row per entity — overall compliance, non-compliance reasons (pipe-delimited) |
| `custom_properties.csv` | Custom fields per entity — contract numbers, project names, entity types |
| `engagement.csv` | Email send/open/click/bounce events per entity |

### TrustLayer Clients
Same CSV structure and column names as Evident. Data is fetched from `data/trustlayer/`. TrustLayer clients are identified by `"platform": "trustlayer"` in `clients.json`. TrustLayer data does not currently include `custom_properties.csv` or `engagement.csv`.

**Current TrustLayer clients:** Block Real Estate Services LLC, Construction Mgmt Inc, QTS Data Centers, DEMO Client

### Snapshot Data
Monthly snapshots live in `snapshots/YYYY/YYYY-MM/` and are used by the Year End Review, Producer Overview, and HUB-Wide Annual reports. Snapshots are point-in-time copies of `insureds.csv`, `criteria.csv`, and `engagement.csv`, created automatically by GitHub Actions on a monthly schedule.

---

## clients.json Reference

Located at `config/clients.json`. This is the master client list. Every client visible in the app must have an entry here.

```json
{
  "clients": [
    {
      "client_name": "ESS Companies",
      "rp_common_name": "esscompanies",
      "program_start_date": "2025-08-01",
      "go_live_date": "2025-09-15",
      "structure": "project",
      "platform": "evident",
      "producer_name": "Paul Cohen",
      "contact_name": "Clayton Hicklin",
      "active": true
    }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `client_name` | ✅ | Must exactly match the `client` column in the CSVs |
| `rp_common_name` | ✅ | Short identifier used in API calls and filenames |
| `program_start_date` | — | Date the service agreement was signed (YYYY-MM-DD) |
| `go_live_date` | — | Date the platform went live with third parties (YYYY-MM-DD) |
| `structure` | ✅ | `general` (vendors) / `project` (subcontractors) / `location` (tenants) |
| `platform` | ✅ | `evident` or `trustlayer` |
| `producer_name` | — | Referring producer — pre-fills Thank You Card and Producer Overview |
| `contact_name` | — | Client day-to-day contact — pre-fills Thank You Card |
| `active` | ✅ | `true` to show in app, `false` to hide (preferred over deletion) |

> **Never hard-delete a client from `clients.json`.** Set `"active": false` instead. This preserves historical report data and snapshot references.

---

## GitHub Actions — Data Sync

The sync workflow lives at `.github/workflows/sync.yml`. It can be triggered:

- **Manually** — from the GitHub Actions tab, or via the Refresh Data button in the app (requires an Access Token with `workflow` scope in Settings)
- **On a schedule** — configure a cron trigger in `sync.yml` for automatic daily or hourly refresh

### Required GitHub Secrets

| Secret | Used By | Description |
|---|---|---|
| `EVIDENT_API_TOKEN` | Evident sync | API token from Evident platform settings |
| `TRUSTLAYER_API_TOKEN` | TrustLayer sync | API token from TrustLayer platform settings |
| `GH_PAT` | Both | Personal Access Token with `repo` and `workflow` scopes for writing CSV data back to this repo |

Secrets are set in **GitHub → Settings → Secrets and variables → Actions**.

---

## User Roles & Access

Authentication is handled by Supabase. User roles are stored in `raw_user_meta_data` on each user's Supabase account.

| Role | Badge Color | Permissions |
|---|---|---|
| `system_administrator` | Navy | Full access — reports, client config, settings, debug tools |
| `account_manager` | Blue | Reports + edit clients |
| `account_administrator` | Grey | Reports only — read-only client config |
| `account_executive` | — | Reports only |

Users are managed in the Supabase dashboard under **Authentication → Users**.

---

## Settings Reference

Settings are stored in `localStorage` and persist between sessions on the same browser. Configured in the app under **Settings → Data Source**.

| Setting | Default | Description |
|---|---|---|
| Data Owner | `HUBCertSecure` | GitHub organization owning this repo |
| Repository | `client-management-platform` | Repository name |
| Branch | `main` | Branch to read data from |
| Access Token | *(blank)* | PAT for Refresh Data button — requires `repo` + `workflow` scope |
| Evident CSV Paths | `data/evident/*.csv` | Paths to each Evident CSV file within the repo |
| TrustLayer CSV Paths | `data/trustlayer/*.csv` | TrustLayer-specific CSV paths |
| TrustLayer Demo Token | *(blank)* | API token for TL Sandbox — set under Settings → APIs |

---

## Known Pending Items

| # | Item |
|---|---|
| 1 | QTS Data Centers exact client column value in TrustLayer CSVs unconfirmed |
| 2 | Year End Review and Producer Overview reports fail for TrustLayer clients — snapshot fetch always hits Evident data |
| 3 | HUB-Wide Annual report is Evident-only |
| 4 | Non-compliance reason breakdown by coverage type to be added to HUB-Wide Annual |
| 5 | Audit log to be built |
| 6 | Automated monthly email (on/off toggle + cadence selector) — outreach cadence is 8 touches |

---

## Adding a New Client

1. **Get the exact client name** from the Evident or TrustLayer platform — it must match the `client` column in the synced CSVs exactly
2. **Open the app → Client Manager → Add Client**
3. Fill in all fields and set `platform` to `evident` or `trustlayer`
4. Click **Save Changes** — this writes the new entry to `config/clients.json` automatically
5. **Trigger a data sync** (Refresh Data button or GitHub Actions) to pull the client's CSV data
6. The client will appear in the Report Generator on next load

---

## Offboarding a Client

1. Open **Client Manager → Edit** on the client
2. Uncheck **Active** and click Save Changes
3. The client disappears from the Report Generator but their data and snapshots are preserved

Do **not** delete the entry from `clients.json` — inactive clients may still be needed for historical Year End Reviews and snapshot reports.

---

## Development Notes

- The entire app is `index.html` — a single self-contained file with no build step or dependencies to install
- External libraries loaded from CDN: **Supabase** (auth), **ExcelJS** (Excel generation), **PapaParse** (CSV parsing)
- All report generation is client-side — no data leaves the browser except for GitHub API calls to fetch CSVs
- To test locally, serve via a local HTTP server (e.g. `python -m http.server 8080`) — do not open as a `file://` URL as GitHub API calls will be blocked by CORS
- Debug panel available to System Administrators via the profile menu → 🐛 Debug

---

## Contacts

| Role | Name | Email |
|---|---|---|
| System Administrator | Philip Irving | philip.irving@hubinternational.com |
| Program Lead | Larry Murrell | larry.murrell@hubinternational.com |

---

*HUB CertSecure · Confidential — Internal Use Only*
