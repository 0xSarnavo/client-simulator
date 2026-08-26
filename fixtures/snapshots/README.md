# Page snapshots

Real accessibility snapshots, captured with `BrowserDriver.snapshot()` — the exact
text a persona sees each step. They exist so snapshot pruning can be proven not to
drop anything a persona needs to act on.

| Fixture | Size | Refs | Why it is here |
|---|---|---|---|
| `tiny-example-com.txt` | 315 B | 5 | Floor case: pruning must leave it alone |
| `form-inputs.txt` | 1.6 KB | 41 | 13 interactive controls — labels and values must survive |
| `small-iana-org.txt` | 6.6 KB | 99 | Ordinary content site |
| `heavy-wikipedia.txt` | 257 KB | 1754 | ~64k tokens in one step. The case pruning exists for |
| `commercial-signup.txt` | 1 KB | 9 | Hand-written. The product tests SaaS onboarding, and no real capture covers it: charge disclosures, prices, validation errors, a readable `generic` node |

Its 89% prune ratio is an artifact of how many noise lines were authored into it
and is **not** evidence about real commercial pages — cite it as a size, never as
a measurement. `commercial-signup.txt` is authored, not captured — it pins the page shape this
tool exists for. Regenerate the rest by pointing `BrowserDriver` at the same URLs (example.com,
httpbin.org/forms/post, www.iana.org, en.wikipedia.org/wiki/Web_accessibility).
Sizes will drift as those pages change; the invariants under test should not.
