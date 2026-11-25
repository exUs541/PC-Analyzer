# Security Policy

## Supported versions

Only the latest release receives fixes. The app updates itself, so users are on the latest release as soon as it has been published.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository
(<https://github.com/exUs541/PC-Analyzer/security/advisories/new>).

Please include what you found, how to reproduce it, and which version is affected. You will get an answer as soon as possible; a fix is released first, and the report is made public afterwards with credit if you wish.

## What counts

The app reads a lot about the PC it runs on and can copy and remove files, so these are the areas where a report matters most:

- a way for a **web page or another local program** to talk to the local server (token, `Host` header, loopback binding);
- a way to make the app **remove or overwrite files** it should not (cloud folders, system folders, Git repositories, anything that changed after confirmation);
- a way to **skip the typed confirmation** (`ENTFERNEN`) of the removal window;
- **leaking** scan data off the PC (the app is designed to make no network request except update checks, the optional GitHub repository list and `winget`);
- problems in the **installer or updater** (the installer is currently not code-signed).

The safety model is described in [docs/architecture.md](docs/architecture.md#safety-model).
