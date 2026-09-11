# Local Commands

```bash
node <skill-directory>/scripts/my-wiki.mjs init /path/to/vault --name personal --use
node <skill-directory>/scripts/my-wiki.mjs --vault personal status
node <skill-directory>/scripts/my-wiki.mjs --vault personal search "query"
node <skill-directory>/scripts/my-wiki.mjs --vault personal capture --title "Title" --url "https://example.com"
node <skill-directory>/scripts/my-wiki.mjs --vault personal capture --file /path/to/document.pdf
node <skill-directory>/scripts/my-wiki.mjs --vault personal capture --directory /path/to/documents
node <skill-directory>/scripts/my-wiki.mjs --vault personal reextract --source references/sources/source-note.md
node <skill-directory>/scripts/my-wiki.mjs --vault personal reextract --all-followup
node <skill-directory>/scripts/my-wiki.mjs --vault personal images --source references/sources/source.md
node <skill-directory>/scripts/my-wiki.mjs --vault personal organize-raw
node <skill-directory>/scripts/my-wiki.mjs --vault personal lint
node <skill-directory>/scripts/my-wiki.mjs --vault personal garden
node <skill-directory>/scripts/my-wiki.mjs --vault personal universes
node <skill-directory>/scripts/my-wiki.mjs --vault personal export-universe "FlexSim"
node <skill-directory>/scripts/my-wiki.mjs --vault personal import-universe /path/to/flexsim.mywiki
node <skill-directory>/scripts/my-wiki.mjs --vault personal import-universe /path/to/flexsim.mywiki --apply
node <skill-directory>/scripts/my-wiki.mjs --vault personal import-universe /path/to/flexsim.mywiki --as "Simulation" --apply
node <skill-directory>/scripts/my-wiki.mjs --vault personal repair-links
node <skill-directory>/scripts/my-wiki.mjs --vault personal okf-audit
node <skill-directory>/scripts/my-wiki.mjs --vault personal export-okf --galaxy "AI"
node <skill-directory>/scripts/my-wiki.mjs --vault personal dashboard
node <skill-directory>/scripts/my-wiki.mjs --vault personal open-dashboard
```

`dashboard` starts the service silently in the background. `open-dashboard` also opens the selected installation's frontend in the browser.
