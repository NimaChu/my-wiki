15 July 2026

Editor-in-Chief
Information and Software Technology

Dear Editor-in-Chief,

Please consider the manuscript "Evidence-Closed Knowledge Maintenance for LLM
Agents: Design and Empirical Evaluation of Agent Wiki" as a Research Paper in
Information and Software Technology.

The manuscript addresses a software-engineering problem that arises when LLM
agents maintain durable external knowledge: a source can be labeled processed
while its synthesis target is missing, unresolved, disconnected from evidence,
or still requires follow-up. We introduce an executable evidence-closure
invariant, implement it in the open-source Agent Wiki system, and evaluate it
through three complementary studies.

The public case study contains 1,092 raw source records, 88 synthesized wiki
records, and 5,163 graph edges. A controlled experiment injects 120 maintenance
faults from four classes into a 1,000-record fixture and compares Agent Wiki
with an existence-only link baseline. A runtime study measures complete scan
and closure checking over 100 to 2,000 raw records. Agent Wiki detects all 120
seeded faults, while the baseline detects 30, and the 95th-percentile runtime
remains below two seconds at the largest studied size.

The contribution fits the journal's interests in software quality, metrics,
process, verification and validation, and empirical software engineering. The
paper makes a deliberately bounded claim: evidence closure establishes
structural traceability, not semantic correctness or superior RAG answer
quality. Code, a public derived dataset, the evaluation protocol, and
machine-readable results support independent inspection and reproduction.

The manuscript is original, is not under review elsewhere, and has been
approved by its sole author. A prior software release and technical-report
draft are available through GitHub and Zenodo; this research article adds a
new fault model, baseline comparison, reproducible mutation experiment,
runtime study, and research-oriented analysis. Any public manuscript version
will be identified as a preprint in accordance with Elsevier policy.

The author has no competing interests and received no specific funding. The
use of OpenAI Codex for manuscript organization, language drafting, LaTeX
preparation, and evaluation-script implementation is disclosed in the
manuscript. The author reviewed and verified the code, data, references,
analysis, and text and takes full responsibility for the work.

The author intends to select the journal's subscription publication route,
which does not require an author publication fee.

Thank you for your consideration.

Sincerely,

Zijun Chu
Independent Researcher
Shanghai, China
chunimav5@gmail.com
https://github.com/NimaChu/agent-wiki
