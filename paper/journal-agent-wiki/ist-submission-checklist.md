# Information and Software Technology Submission Checklist

Updated: 2026-07-15

## Manuscript

- Article type: Research Paper.
- Target journal: Information and Software Technology.
- Main source: `ist.tex`.
- Structured abstract uses Context, Objective, Methods, Results, Conclusion.
- Abstract is below the 300-word limit.
- Research-paper limit is 15,000 words including references and appendices;
  figures and tables count as 200 words each under the journal guide.
- Seven English keywords are provided.
- Corresponding author, full postal address, and email are present.
- Data and software availability statement is present.
- CRediT, competing-interest, funding, and generative-AI declarations are present.

## Empirical Package

- Run `npm run paper:ist-evaluate` from the repository root.
- Check `experiments/ist-evaluation-results.json` against all manuscript values.
- Check the runtime and fault-injection CSV files against Tables 4 and 5.
- The experiment script and results are archived in GitHub release `v0.2.2`
  and Zenodo DOI `10.5281/zenodo.21368436`; the availability statement in
  `ist.tex` has been updated accordingly.
- Keep Autodesk documentation text, snapshots, and images out of the public
  package; publish only the approved metadata and derived structures.

## Separate Files

- Upload the editable LaTeX source and all required supporting files.
- Upload `ist-highlights.txt`; it contains five highlights of at most 85 characters.
- Upload the cover letter based on `ist-cover-letter.md`.
- Generate the Elsevier competing-interests declaration as a separate `.docx`
  with the official declarations tool.
- A graphical abstract is encouraged but not mandatory.

## Submission Choices

- Select the Subscription publication route to avoid an author publication fee.
- Do not select paid Open Access unless the author later changes this decision.
- Disclose the existing GitHub/Zenodo technical-report material as a preprint or
  related public artifact; the manuscript is not under review elsewhere.
- Confirm that the manuscript is not simultaneously submitted to another journal.

## Final Verification

- Re-run the evaluation on the exact release submitted for review.
- Compile `ist.tex` and inspect every page, table, URL, and line break.
- Validate reference titles, author lists, venues, years, and DOI links.
- Confirm manuscript word count under the journal's counting rules.
- Confirm the final manuscript PDF contains DOI `10.5281/zenodo.21368436`.
