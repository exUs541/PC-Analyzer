# Tests

Developer tests for the dashboard logic (`web/*.js`), run with Node's built-in test runner. The C# side has its own xUnit project in `../app/tests`.

```bash
node tests/make-fixtures.js      # writes tests/fixtures/*.json: realistic, invented system snapshots (needed once)
node --test tests/               # all dashboard logic tests
node --test tests/space.test.js  # a single file
```

The dashboard modules attach to a global `LC`; `load.js` loads them into a Node context, so the exact functions the browser runs are tested without a browser.

| File | What it checks |
|---|---|
| `analysis.test.js` | "Last used" assignment, memory scenarios, recommendations, robustness against odd input |
| `files.test.js` | Files and cloud analysis (optional: `FILES_JSON=<path>` also checks a real `LaptopCheck.exe --scan-files-only --out <path>` result) |
| `projects.test.js`, `cleanup.test.js` | Projects and GitHub, the clean-up list with affected objects |
| `space.test.js`, `leftover.test.js` | Storage analysis: classification, nothing counted twice, every level of the folder tree adds up; the old-mirror folder against the live drive |
| `folders.test.js` | Inventory of program-data folders: owner, status, leftovers after an uninstall |
| `house.test.js`, `apply.test.js` | House rules and the saving plan; what one click of "apply the recommendation" does (and never does) |
| `compare.test.js` | The sentence, counts, folder tree, lists and CSV of the two-folder comparison |

`scenario.js` is a shared test scenario (a fixture snapshot plus a few programs, a files scan and projects); `make-ui-data.js` writes it as a data folder for manual browser tests:

```bash
node tests/make-ui-data.js ui-data
dotnet run --project app/src/LaptopCheck.App -- --data-dir ui-data --web-root web
```

For a richer pretend laptop (nearly full C:, Google Drive, old mirror folder, storage analysis, folder comparison) use `node tools/make-demo-data.js demo-data`.
