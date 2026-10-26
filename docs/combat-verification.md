# Combat formula verification — 26 October 2026

Current Goal: make build calculations match the installed game's executable and show the remaining model assumptions.

Latest Decision: use independent execution of the native arithmetic as the reference. Correct proven differences, retain native test fixtures, and leave unknown action or encounter behavior explicitly unverified.

## Reference and method

Executable: `FFRS-Win64-Shipping.exe`, SHA256 `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`, image base `0x140000000`.

Scalar SSE instruction blocks were copied from that executable into an isolated research process. Constants came from the image; exponential and power calls used the installed UCRT `expf` and `powf`. This executes the game's arithmetic independently of the JavaScript implementation. It does not inject into the game or change its executable or saves. Supplied inputs isolate the calculation kernels from battle state.

| Check | Independent samples | Differences after correction |
| --- | ---: | ---: |
| Piecewise attack/defense ratio | 1,009 boundary and seeded random pairs | 0, bit exact |
| HP multiplier arithmetic | 5,000 seeded inputs | 0 integer damage differences |
| Equal-level stagger arithmetic | 5,000 seeded inputs | 0 integer stagger differences |
| Stagger level factor | All 9,801 attacker/target level pairs from 1 to 99 | 0, bit exact |

Twenty small reference cases, including exact raw float values and the original failures, are retained in `tests/fixtures/native-combat.json`. Run `node --test tests/native-combat.test.cjs` from the repository to check the JavaScript against them. Their provenance includes the executed block addresses and executable hash. The full extraction harness and generated samples are local research artifacts, not required to run the public tests.

## Corrections

- **Native percentage rounding:** critical, staggered-target, area and extra-phase multipliers use `float(float(percent * float(.01)) + 2^-23)`. Omitting the final epsilon produced seven one-point HP errors in 5,000 cases. For example, ATK 998, DEF 86, level 40, coefficient 268, critical and staggered with area reduction, element ×.5, outgoing ×1.2 and hit ratio ×.5 yields **9,117**, previously **9,116**.
- **Stagger level constant:** the image stores `0.09999999403953552` at `0x148959F34`, one float below `.1`. The floor remains `float(.1)`. Level 1 attacking level 15 with raw stagger 935 yields **480**, previously **479**.
- **Magic Boost MP cost:** the native cost routine multiplies float factors, clamps nonzero costs to at least one, then truncates. Costs 15 and 19 become **22 and 28**, previously **23 and 29**. Zero cost remains zero. The generic helper also checks independently stacked cost factors.
- **Higher-stat effects:** Legendary SOLDIER's Dominant Power uses the greater computed ATK or MAG. Its Dominant Defence uses the greater computed physical or magic defense. They now affect attack inputs, target defense inputs and the existing durability heuristic. Job Change has a command-102 condition; shared spell availability alone does not prove that command was selected, so it stays deferred when command context is unknown.

Recuperate LB was also checked: its percentage operation explicitly uses a basis of **100** for the LB parameter. The existing 30-point refund is correct even if maximum gauge is 200; it was not changed.

## Native locations

- Ratio kernel: `0x14522F1FF–0x14522F286`.
- HP multiplier sequence: `0x145232B5B–0x145232D93`; critical factor `0x145238C94–0x145238CA9`; area factor `0x14523748E–0x14523749B`; staggered factor `0x145232BC4–0x145232BCF`; extra phase `0x145232BFD–0x145232C08`.
- Stagger arithmetic and level branch: `0x145232253–0x1452322F2`.
- MP cost: `0x145149D10`, multiply/clamp/truncate at `0x145149DFD–0x145149E09`; cost factor getter `0x145115270`, factor aggregation `0x1452388E0`.
- Higher attack: aggregator `0x145244470`, Dominant Power getter `0x145150170` through vtable `0x1486ABC28 + 0x600`; command comparison reads battle state `+0x430`.
- Higher defense: aggregator `0x145244400`, Dominant Defence getter `0x140C8A800` through vtable `0x1486AB578 + 0x608`.
- LB percentage basis: `0x145139734–0x14513973A`.

## What remains an estimate

These checks establish agreement for the sampled arithmetic kernels and identified native effect rules. They do not establish that every encounter supplies the same base stats, that every passive event fires, or that a five-round action sequence matches gameplay.

Still unverified: Arms Akimbo/Dualcast repetition restrictions and sequencing, Magic Boost's duration over multiple actions, stagger recovery duration, some LB award recipients and timing, identical-effect stacking, runtime Spirit expansion, unknown artifacts and encounter overrides. Unsupported effects remain visible; the five-round result retains its timing assumptions and is not a proven global optimum.

Next Step: trace the remaining event and action handlers when those mechanics affect a recommendation. Recorded battles can provide a separate end-to-end check; they are not a prerequisite for recovering formulas.

Known Blockers: no recorded battle damage was used in this verification. The executable hash limits these conclusions to the inspected version.
