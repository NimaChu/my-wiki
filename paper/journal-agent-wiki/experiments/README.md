# IST Evaluation Reproduction Package

This directory contains the executable evaluation used for the Information and
Software Technology research article, "Evidence-Closed Knowledge Maintenance
for LLM Agents: Design and Empirical Evaluation of Agent Wiki."

## Run

From the repository root, execute:

```bash
npm run paper:ist-evaluate
```

The script evaluates the public metadata-only FlexSim-derived case-study
dataset, runs deterministic fault injection, and measures closure-checking
runtime. It writes the following machine-readable outputs in this directory:

- `ist-evaluation-results.json`
- `ist-fault-injection-results.csv`
- `ist-runtime-results.csv`

## Scope and reproduction notes

The controlled fault-injection and runtime fixtures are generated locally by
the script. The public dataset contains derived metadata and graph structure
only; Autodesk documentation text, snapshots, and images are intentionally not
redistributed. Runtime measurements depend on the executing machine, so the
published values should be interpreted as the reported experimental run rather
than a hardware-independent performance guarantee.

The evaluated software release is `v0.2.1`. Release `v0.2.2` archives this
reproduction package and the IST submission materials without changing the
closure-checking implementation evaluated in the study.
