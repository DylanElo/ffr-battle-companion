# Ordinary ActionBegin MP recovery

Auto MP Restore (S/M/L) is modeled from native effects 1282/1283/1284 and passives 1254/1255/1256. The effects are unconditional, deterministic Self/Friendlies effects installed at SpawnUnit, with permanent duration and ActionBegin apply/proceed timing. This support is restricted to their verified parameter layouts; arbitrary recovery rows are not inferred from descriptions.

| Effect | Native parameters | Recovery |
| --- | --- | --- |
| 1282 | `[5, 2, 0, -1, 0, ...]` | 5 MP |
| 1283 | `[3, 2, 2, -1, 0, ...]` | 3% of actual maximum MP |
| 1284 | `[5, 2, 2, -1, 0, ...]` | 5% of actual maximum MP |

Parameter 1 selects MP (2). Variation 0 is a flat increase; variation 2 is RatioIncrease. Remaining parameters must match the native row.

## Arithmetic and bounds

The generic ParameterVariation handler is `0x1451395D0`. RatioIncrease arithmetic at `0x145139750–0x145139776` uses the actual MP maximum from dispatch `0x14523C320`, rather than the special 100-point LB basis:

```text
ratio = float32(float32(value × float32(0.01)) + 2^-23)
amount = truncate(float32(float32(maximumMP) × ratio))
```

Flat recovery uses the native integer amount. Recovery has no artificial minimum of one: 3% or 5% can restore zero when maximum MP is small. MP delta dispatch `0x145230953` reaches setter `0x14524AED0`, which clamps the updated MP to its legal range. Each native effect truncates and updates/clamps separately; percentages are not combined before rounding, and excess recovery is not banked.

The repository fixture `tests/fixtures/native-mp-recovery.json` contains 30 isolated executions of the copied native scalar instructions and constants. It identifies executable SHA-256 `B8C588E46EBADBE37FECA7BDF2DA0AE63A8538099D14A53EC0C2241B086E5FFA`. No game process or save was modified. The regression `tests/mp-recovery.test.cjs` compares the helper against all 30 outputs and separately checks flat recovery and invalid inputs. These scalar executions verify arithmetic, not an entire live encounter.

## Event scope

Ordinary manual command entry invokes ActionBegin event 2 before emitting `Delegate.Battle.Cmd.Begin`, as traced in [MP cost verification](mp-cost-verification.md). The model applies the verified recovery before fresh ordinary command affordability and before that command's payment. A partially filled starting MP pool can therefore fund a first command after recovery; a full pool gains zero from an already capped effect.

Additional and Finish do not receive a second ordinary ActionBegin recovery. Selected children inside Arms Akimbo, Dualcast or Magic Barrage also do not independently replay the actor-start event. Runtime MP and supported MP-dependent damage bonuses are updated as actions pay their actual costs. A source with no remaining HP does not gain an invented extra action.

On-hit, on-critical, on-stagger, on-kill and received-damage MP restoration, walking-based MP Stroll, arbitrary status regeneration, and enemy-specific recovery events remain excluded unless separately modeled and verified. Auto MP Restore does not imply support for those triggers or an ordinary healing objective.
