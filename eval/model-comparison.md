# Embedding model comparison (v3 §E4)

Baseline: **all-MiniLM-L6-v2 (current)** · Candidate: **Xenova/bge-small-en-v1.5 (candidate)**
Judge: claude-sonnet-5 · baseline n=400, candidate n=400

| bucket | all-MiniLM-L6-v2 (current) | Xenova/bge-small-en-v1.5 (candidate) | Δ |
|---|---|---|---|
| **overall** | **78.3%** | **79.8%** | **+1.5** |
| cross-media | 66.3% | 82.5% | +16.2 |
| movies | 72.5% | 80% | +7.5 |
| tv | 82.5% | 67.5% | -15 |
| books | 87.5% | 82.5% | -5 |
| music | 80% | 67.5% | -12.5 |
| games | 80% | 85% | +5 |
| anime | 75% | 82.5% | +7.5 |
| food | 87.5% | 85% | -2.5 |
| travel | 85% | 82.5% | -2.5 |

## Verdict

**SWITCH → Xenova/bge-small-en-v1.5 (candidate).** Overall accuracy improved by +1.5 pt (≥ 1 pt gate).

> Gate: switch only if the candidate's overall triplet accuracy beats the baseline by ≥ 1 pt. Both models are 384-d, so a switch is a drop-in — just change `embed.mjs`'s default `EMBED_MODEL` and let the next embed run rebuild `embeddings.b64.json`.
