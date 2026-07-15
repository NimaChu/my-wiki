# Agent Wiki SoftwareX Submission Notes

Draft updated: 2026-07-15

## Target and Article Type

Target journal: SoftwareX

Article type: Original Software Publication

The official journal-specific LaTeX structure is used in `softwarex.tex`. The
generic journal manuscript remains in `main.tex` as a longer source document;
it should not be uploaded as the SoftwareX manuscript.

## Official Constraints Applied

- Short descriptive software paper with a current 3000-word running-text limit.
- Mandatory SoftwareX template and five main sections.
- Public open-source GitHub distribution with supporting material.
- Mandatory code metadata table.
- Maximum six figures; no figures are currently included.
- Three to five separate highlights, each no more than 85 characters.
- Generative-AI use must be declared when used for manuscript preparation.
- Research data must be deposited and linked, or non-sharing must be explained.

## Submission Positioning

The paper positions Agent Wiki as domain-independent research-support software
for maintaining inspectable, source-grounded knowledge used by LLM agents. The
scientific-software value is the combination of:

- local ownership of evidence and synthesis;
- executable evidence-closure checks;
- reusable capture, search, lint, link-repair, and image-evidence workflows;
- an optional read-only graph dashboard;
- compatibility with future RAG or MCP layers without making them mandatory.

The case study supports a claim of mechanical graph health at documentation
scale. It does not establish semantic correctness, user-productivity gains, or
superiority over RAG baselines.

## Remaining Submission Step

1. Enter the provided phone number directly in Editorial Manager; it is not
   stored in the public repository.

## Current Evidence

The local status and lint commands were run on 2026-07-15:

- nodes: 1275
- graph edges: 5444
- raw sources: 1137
- wiki pages: 127
- processed raw sources: 1136
- pending, inbox, stale, and follow-up raw sources: 0
- unresolved links: 0
- invalid relation hints: 0
- orphaned wiki pages: 0
- processed-source closure issues: 0

The local case-study corpus is intentionally excluded from the public repository
by default. The manuscript's data statement describes this limitation.
