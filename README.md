# csv-reader-speed-01 — fast drop-in for csv-reader 1.0.0

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Wahyupurnomoaji21/csv-reader-speed-01-run-20261121-v1/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Wahyupurnomoaji21/csv-reader-speed-01-run-20261121-v1/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own **csv-reader 1.0.0**: `solve.js`
(`run({text, header}) → {columns, rows, errors}`) answers exactly as
csv-reader 1.0.0 does on every input — same broken-row policy (BOM,
CRLF/LF, stray CR, quoted fields with `""` and embedded line breaks,
quote junk, unterminated quotes, short/long rows, error records) — but
much faster than the reference's one-character-at-a-time loop.

## How it is faster

- **Whole-record fast path:** a record with no quote and no stray CR is
  one slice plus a native `split(',')`.
- **indexOf jumps:** unquoted fields jump to the next delimiter
  (`,`, LF, CR) instead of stepping per character; a quoted field's
  closing quote is found with `indexOf` jumps and a clean quoted field is
  taken as one slice.
- No regex, no per-character string building, no caching between cases:
  every `run(input)` is standalone.

## Files

| File | What it is |
|---|---|
| `solve.js` | The entry: dependency-free ES module, exports `run(input)` |
| `main.ts` | The harness driver: reads `/input/cases.json`, writes `/output/answers.json` |
| `README.md` | This file |
| `LICENSE` | MIT |

## Test locally

```sh
# correctness vs the reference on the practice set (6 cases)
node test-practice.mjs   # not shipped; see below

# or run the driver directly against the kit's practice input:
MAKEFUN_INPUT_DIR=/path/to/kit/practice/input \
MAKEFUN_OUTPUT_DIR=/tmp/csv-out \
node main.ts
```

Correctness was verified against the kit's reference
(`baselines/csv-reader/vendor/csv-reader/index.js`): 6/6 practice
cases byte-identical to `practice/reference/expected.json`, plus
hand-written edge cases and randomized fuzzing with 0 mismatches vs
the reference. Speed on the practice set (~11 MB of CSV): clearly
faster than the house baseline (see the build report for numbers).

## License

MIT — see [LICENSE](LICENSE).
