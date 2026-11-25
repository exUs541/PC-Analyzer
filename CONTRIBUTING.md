# Contributing

Thanks for your interest in PC-Analyzer! Bug reports, ideas and pull requests are welcome.

## Before you start

- Open an issue first for anything bigger than a small fix, so we can agree on the direction.
- Be kind: this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Security problems** do not belong in public issues; see [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Windows 10/11, the [.NET 10 SDK](https://dotnet.microsoft.com/download) and Node.js 20+.

```powershell
git clone https://github.com/exUs541/PC-Analyzer.git
cd PC-Analyzer
dotnet build app/LaptopCheck.slnx
node tests/make-fixtures.js
```

Run the app against invented data instead of your own PC:

```powershell
node tools/make-demo-data.js demo-data
dotnet run --project app/src/LaptopCheck.App -- --data-dir demo-data --web-root web
```

`--web-root web` serves the dashboard straight from the folder, so changes to `web/*.js` only need a browser reload.

## Tests

```powershell
dotnet test app/LaptopCheck.slnx     # xUnit
node --test tests/                   # dashboard logic (after node tests/make-fixtures.js)
```

Both suites run in CI on every push and pull request. New behaviour needs a test; a bug fix needs a test that failed before the fix.

## Project conventions

- **Reading and writing are separate.** Code in `LaptopCheck.Scan` must never write outside the data folder. Anything that changes the user's files lives in `LaptopCheck.Cleanup`, is validated again on the server, and goes to the Recycle Bin, never straight to deletion.
- **The page proposes, the server decides.** Never trust a path or flag that comes from the dashboard; rebuild what is allowed from server-side state.
- **Rules are readable data.** Heuristics in `web/` (`knowledge.js`, `space.js`, `findings.js`, …) are tables and small functions that can be read and tested, not opaque logic. Explain *why* in the message the user sees.
- **No dependencies in the dashboard** and no network access from it.
- Keep user-facing text German (the dashboard is German); code, comments and developer docs are English.
- Follow `.editorconfig`; keep changes focused and the diff small.

## Pull requests

1. Fork, create a branch (`feat/…` or `fix/…`).
2. Make the change with tests; run both test suites.
3. Describe *what* and *why* in the pull request and note anything a reviewer should look at (the template asks for it).
4. Keep the history readable: small, meaningful commits.

## Releases

Releases are built by the `Release` workflow when a `v*` tag is pushed (or when it is started manually): tests, a real install/update/uninstall test, then installer and update packages via Velopack.
