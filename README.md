# Read broken CSV files faster

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Putra-122/makefun-csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Putra-122/makefun-csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: it answers exactly as
the reference does on every case — the same broken-row policy (stray_cr,
quote_junk, unterminated_quote, short_row, long_row), the same error objects,
the same header handling — but in about a quarter of the reference's CPU time
on the practice set (~4x faster parsing, ~1.7x faster end to end including
the JSON input/output the driver does for both).

Built for the [make.fun csv-reader-speed-01-run-20261121 bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

## How it works

`solve.js` (ES module, `run(input)` returns `{columns, rows, errors}`) reads
each CSV text in a single pass:

- Fields are slices of the input, never built a character at a time, so the
  common plain field costs one substring.
- The next delimiter of an unquoted field is found by a tight `charCodeAt`
  loop; a stray CR is dropped with its error and the field continues.
- A quoted field jumps to its closing quote with `indexOf`, doubled quotes
  collapse to one, and CR/CRLF inside quotes becomes one LF while the line
  count is kept — the line an error reports is still the line its record
  started on, exactly as the reference does.
- A quote that never closes is read again as unquoted from just after it,
  with the quote itself as a literal first character.
- No object is allocated per field; one shared scratch object carries the
  reader's result.

`main.ts` is the house driver, unchanged: it reads every case from
`/input/cases.json`, answers each one alone with `run()`, and writes
`/output/answers.json`. Outside a container `MAKEFUN_INPUT_DIR` and
`MAKEFUN_OUTPUT_DIR` stand in for `/input` and `/output`.

## Local results (practice set, 6 cases, ~10.2 MB of CSV)

- Correctness: all 6 cases match the reference answer exactly, and the
  scorer passes 6/6.
- Speed, parsing only (5 repetitions): mine ~125 ms mean vs reference
  ~502 ms mean — about 4.0x faster.
- Speed, whole driver end to end (3 runs each): mine ~935 ms mean vs
  baseline ~1,599 ms mean — about 1.7x faster.
- Determinism: two runs write byte-identical `answers.json`.
