# diff-speed — a faster drop-in for makefun-diff 1.0.0

[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![Rank](https://make.fun/badge/diff-speed-01-run-20261126/Hachiko66/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![Reward](https://make.fun/badge/diff-speed-01-run-20261126/Hachiko66/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

Entry for the [Diff two texts faster bounty](https://make.fun/bounty/diff-speed-01-run-20261126) on make.fun: a faster drop-in for make.fun's own makefun-diff 1.0.0 that answers exactly as it does on every case.

## How it works

`solve.js` is a dependency-free ES module whose `run({ old, new })` returns makefun-diff's patch, byte for byte:

- Lines are cut after every `\n` (a last line with no `\n` is a line too); the common line prefix is kept, then the common suffix of what is left.
- Between them runs the reference's exact greedy Myers search: on each diagonal the path furthest into the old text wins, a deletion wins over an insertion on ties, no diagonal is pruned, and every run of equal lines is followed to its end.
- The patch is formatted exactly as makefun-diff formats it: header line, hunks with 3 context lines, runs at most 6 kept lines apart sharing a hunk, deletions before insertions, and a `%` line after a final line with no newline.

The speed comes from interning lines to small integers (one `Map` per case, each code also carrying whether the line ends with `\n`) and keeping the Myers V-trace in a single flat `Int32Array` — `V_d` at offset `d*d` — so backtracking needs no linked lists and the search allocates nothing while it runs.

`main.ts` (Node 22, standard library only) reads `/input/cases.json`, answers each case with `run`, and writes `/output/answers.json`. Run it locally with `mkdir -p out && MAKEFUN_INPUT_DIR=<cases dir> MAKEFUN_OUTPUT_DIR=out node main.ts`.

## Verification

Checked against the kit's practice set (4 cases, ~21k–31k lines each): all 4 answers identical to the reference `expected.json`. Timed locally against the house baseline `makefun-diff` on the same set — see the run log for the numbers.

## License

MIT — see [LICENSE](LICENSE).
