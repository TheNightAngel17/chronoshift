# Architecture Decision Records

One file per decision, numbered sequentially: `0001-slug.md`, `0002-slug.md`. An ADR can be a single paragraph — the value is recording *that* a decision was made and *why*, not filling in sections.

Write one only when all three are true:

1. **Hard to reverse.** Changing your mind later carries real cost.
2. **Surprising without context.** A future reader will wonder why on earth it was done this way.
3. **A real trade-off.** There were genuine alternatives and one was chosen for specific reasons.

If a decision is easy to reverse, skip it — you will just reverse it. If nobody would wonder why, there is nothing to explain. If there was no alternative, "we did the obvious thing" is not worth a file.

Decisions that clear the bar here get a one-line pointer from the section of `../BUILD_PLAN.md` they affect, so the spec stays the single place to start reading.
