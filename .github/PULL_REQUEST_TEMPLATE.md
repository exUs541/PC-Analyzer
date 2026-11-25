## What and why

<!-- What does this change, and why? Link the issue if there is one. -->

## How it was tested

- [ ] `dotnet test app/LaptopCheck.slnx`
- [ ] `node --test tests/` (after `node tests/make-fixtures.js`)
- [ ] Tried in the app or the dashboard (demo data is fine)

## Checklist

- [ ] New behaviour has a test; a bug fix has a test that failed before
- [ ] Code that changes files is in `LaptopCheck.Cleanup`, is validated on the server and uses the Recycle Bin
- [ ] No personal data (names, paths, serial numbers) in code, tests or screenshots
- [ ] User-facing text is German, code and comments are English
- [ ] Docs updated if behaviour changed (`docs/`, `CHANGELOG.md`)

## Notes for the reviewer

<!-- Anything risky, unfinished or worth a second look. -->
