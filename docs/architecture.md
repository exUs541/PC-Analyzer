# Architecture

PC-Analyzer (the app is called **LaptopCheck**) is a Windows desktop app made of three layers: a small native host window, a local web server, and a dependency-free web dashboard. All analysis of *what the scans mean* lives in readable JavaScript; everything that touches the machine lives in C# behind explicit safety checks.

```text
┌───────────────────────────── LaptopCheck.exe (WinForms, WebView2) ─────────────────────────────┐
│  MainForm ── hosts WebView2 ───────────────┐          confirmation window (ENTFERNEN)         │
│                                            ▼          folder picker                            │
│  Kestrel on 127.0.0.1 (token per start) ◄── web/  (HTML, CSS, vanilla JS, no build step)       │
│     │  /api/*                                                                                  │
│     ├─ Scan      system scan · files scan · storage analysis · folder compare   (read-only)    │
│     ├─ Cleanup   move to cloud · restore · recycle · uninstall · winget · organize             │
│     ├─ GitHub    sign-in discovery · repo list                                                 │
│     ├─ Update    Velopack self-update · start guard                                            │
│     └─ Core      data folder · JSON stores · state · contracts                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
        data folder: %LOCALAPPDATA%\LaptopCheckData\data   (snapshot.json, files.json, space.json, notes.json, …)
```

## Solution layout (`app/`)

| Project | Responsibility |
|---|---|
| `LaptopCheck.Core` | Data folder (`DataPaths`), atomic JSON stores, state builder, the *contracts* (interfaces) between host and modules. No UI, no network. |
| `LaptopCheck.Scan` | **Read-only** measuring: system scan (WMI, registry, Store apps, usage history, winget), files scan (folders, cloud folders, duplicates, Git repositories, program data), storage analysis of the system drive, two-folder comparison. Every section is guarded on its own, so one unreadable area never fails a scan. |
| `LaptopCheck.Cleanup` | The only project that changes files: verified copy to a cloud folder, restore of missing files, Recycle Bin removal, uninstall, winget, organize. Every request is validated again server-side. |
| `LaptopCheck.GitHub` | Finds an existing GitHub sign-in (credential manager, GitHub Desktop, `gh`, git) or starts one in the browser; lists repositories. |
| `LaptopCheck.Update` | Self-update with [Velopack](https://velopack.io), start guard (repair mode after repeated failed starts). |
| `LaptopCheck.Server` | Kestrel minimal server: serves `web/`, routes `/api/*`, checks token and `Host` header. |
| `LaptopCheck.App` | The window (WebView2), single-instance handling, confirmation and folder-picker windows, command line. |
| `LaptopCheck.Tests` | xUnit tests with fakes for the registry, the system probe, the process runner, the Recycle Bin and the confirmation window. |

Modules talk through interfaces in `Core` (`IScanRunner`, `IFilesScanRunner`, `ICleanupActions`, `ICompareActions`, `IUpdateActions`, `IConfirmation`, `IRecycleBin`, `ISystemProbe`, …). The server only routes JSON text; it never interprets domain data.

## The dashboard (`web/`)

Plain scripts that attach to one global (`LC`); no bundler, no framework, no network access. Files are loaded in dependency order by `index.html`.

```text
raw scans (JSON)  ─►  LC.analyze(raw, opts)  ─►  model  ─►  pages (page-*.js)
```

`LC.analyze` (`model.js`) is a pure function and the heart of the dashboard:
`normalizeSnapshot` → `analyzeHardware` → `buildInventory` → `buildFindings` → `analyzeFiles` → `analyzeProjects` → `analyzeSpace` → `analyzeFolders` → `analyzeHouse` → `savingsPlan`. Each step has its own module and its own tests, all runnable in Node without a browser (`tests/load.js` loads the modules into a Node context).

| Module | What it knows |
|---|---|
| `knowledge.js` | Built-in tables: well-known programs, support dates, relations between programs |
| `inventory.js`, `hardware.js` | "Last used" assignment, recommendations per program, hardware assessment, upgrade advisor |
| `findings.js` | Rules that turn measurements into findings with recommended actions, the overall score |
| `files.js`, `projects.js` | Documents/cloud analysis, projects and repositories |
| `space.js` | Classifies the biggest folders of the drive (what is it, can it go, how) and builds the exact-sum folder tree |
| `folders.js` | Inventory of program-data folders: owner, last use, leftover after uninstall |
| `house.js` | The user's house rules (what stays, what moves to the cloud, what can go) and the saving plan |
| `compare.js` | Presents the result of a two-folder comparison |
| `apply.js` | "Apply the recommendation": builds the exact list a dialog shows, then runs the steps through the server |

The rules are deliberately readable JavaScript tables, not a model: every statement the dashboard makes can be traced to a rule and the data behind it.

## Data

Everything lives in the data folder, never in the program folder, so updates and uninstalling cannot touch it.

| File | Content |
|---|---|
| `snapshot.json`, `snapshot.prev.json`, `history.json` | Last system scan, the one before (for "since the last scan"), trend values |
| `files.json` | Files scan: folders, cloud providers, duplicates, large files, Git repositories, program-data folders |
| `space.json` | Storage analysis of the system drive |
| `compare.json` | Result of the last two-folder comparison |
| `notes.json`, `projects.json`, `repos.json`, `config.json` | What the user entered, projects, repository list, settings |
| `cleanup.json`, `cleanup-log.jsonl`, `moves/`, `deletes/`, `restores/` | Clean-up list with confirmations, log, one folder per job (manifest, log, result) |

Writes go through `AtomicFile` (write to a temporary file, then replace), so a crash never leaves half a document.

## API (all under `/api`, token required)

- **State and stores:** `GET /state`, `GET|PUT /store/{notes|history|config|projects|repos|cleanup}`
- **Scans:** `POST /scan`, `POST /scan-files`, `POST /scan-space`, `GET /space`, `GET /files`, `POST /compare`, `GET /compare/last`
- **Clean-up:** `POST /move/start`, `GET /move/status`, `POST /move/cleanup`, `POST /restore/start`, `POST /delete/start`, `POST /uninstall`, `POST /winget/upgrade`, `POST /reveal`, `POST /organize/*`
- **GitHub and updates:** `GET /github/status`, `POST /github/sync`, `GET /update/state`, `POST /update/restart`
- **Host:** `POST /pick-folder`, `POST /open` (fixed allow-list of Windows tools), `POST /shutdown`

## Safety model

1. **Local only.** The server binds to loopback, requires a random token per start (injected into `index.html`) and checks the `Host` header, so other web pages cannot talk to it.
2. **Scans read.** The scanning modules never write outside the data folder (a test asserts this for the folder comparison).
3. **The page proposes, the server decides.** For every action the server rebuilds what is allowed from its own state — detected cloud folders, the saved confirmation, the last scan — and ignores paths or flags it cannot verify. It refuses Windows and program folders, cloud folders (a delete there would be synced), the user folder itself, `.ssh`, folders that contain Git repositories, links, and anything that changed after the user confirmed it.
4. **Nothing is deleted for good.** Removal goes to the Recycle Bin, after a window of its own lists what will happen and the exact word `ENTFERNEN` is typed. The condition is checked again when the window closes; a synthetic click on a disabled button is not enough.
5. **Copies are verified.** Moving to a cloud folder copies, compares every file by SHA-256, never overwrites, and removes originals only after a second confirmation. Restoring files into the cloud drive reads every copy back and removes a copy that differs.
6. **Jobs leave a trace.** Each job has a manifest, a log and a result in its own folder; background errors go to `app-errors.log`.

## Updates and the start guard

The installed app asks the GitHub releases of this repository hourly (Velopack, small delta packages), downloads quietly and installs when the app closes; the dashboard offers "restart now" and restarts on its own after two idle minutes when nothing is running. A start only counts as successful when the dashboard has loaded; after three failed starts of one version the app looks for a newer one immediately (repair mode).

## Testing strategy

- **xUnit** (`app/tests`): scan sections against a fake PC (`MockPc`), services against a sandbox folder with a Recycle Bin that is just a folder, the HTTP surface through a real in-process server.
- **node:test** (`tests/`): the dashboard logic against generated fixtures (`tests/make-fixtures.js`) and hand-built scenarios; the same pure functions the browser runs.
- **CI** (`.github/workflows`): both suites on every push and pull request; the release workflow additionally installs, updates and uninstalls the app for real under a test id.

## Design decisions

- **Server-rendered knowledge, client-side rules.** The C# side measures; the JavaScript side interprets. That keeps the rules editable and testable without Windows.
- **JSON documents as the contract** between scans and dashboard; every document has a Node-side normalizer that tolerates the quirks of PowerShell/.NET serialization (single-element arrays, missing fields).
- **No dependencies in the dashboard.** No CDN, no fonts, no scripts from the internet; the dashboard works offline and cannot leak data.
- **Honest numbers.** The storage analysis never counts a byte twice, shows what it could not read, and says when a value is an estimate.
