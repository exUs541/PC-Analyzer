# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.0] — native Windows app

The project started as a PowerShell dashboard and was rebuilt as a normal Windows application: one program with its own window instead of scripts. The dashboard (`web/`) stayed, server and scans were rewritten in C#.

### Added

- **Native app** (C# / .NET 10, WinForms + WebView2, local Kestrel server) with per-user installer and self-update (Velopack); start guard with repair mode.
- **System scan:** hardware, Windows support dates, security, battery, memory modules, programs including Store apps, "last used" from Windows' usage history, startup items, `winget` updates.
- **Files scan:** folders, cloud folders (Google Drive, OneDrive, Dropbox, Proton Drive, iCloud), duplicates, large files, Git repositories, program-data folders.
- **Storage analysis:** read-only analysis of the whole system drive; explanation and removal advice for every large folder; folder tree in which every row is the sum of the rows below it.
- **Inventory:** where does each program-data folder come from, is it still needed, leftovers after an uninstall.
- **House rules and saving plan:** rules for what stays local, what moves to the cloud and what can go; one-click recommendations with a dialog that lists exactly what will happen.
- **Cloud awareness:** detection of a leftover mirror folder of Google Drive, file-by-file comparison with the live drive, verified restore of missing files (SHA-256, never overwriting).
- **Folder comparison:** any two folders, one-sentence verdict, folder tree of the differences, lists with search, CSV export; optional content check.
- **Clean-up:** verified move to a cloud folder, removal to the Recycle Bin after a typed confirmation in a window of its own, program uninstall through the vendor's own uninstaller, `winget` updates.
- **Organize:** deep folder analysis with tags, duplicate detection by content, proposal for a folder structure, apply and undo.
- **Projects and GitHub:** projects with needed resources, GitHub repositories (also private) matched with local clones.
- **Updates:** hourly check, "new version loaded" notice, automatic restart into the new version when the window has been idle and nothing runs.
- Test suites: xUnit (scans, services, HTTP surface) and `node:test` (dashboard logic), run in CI; release workflow with a real install/update/uninstall test.

### Changed

- Dashboard simplified to five menu entries with tab strips; text input is saved when a field is left (Enter, Tab or a click elsewhere) and never lost to a background refresh.

### Removed

- The original PowerShell implementation (`Start.bat`, `collect.ps1`, …); the native app covers everything it did.
