# CheckIt backend

The backend package implements read-only Supabase extraction, deterministic Parquet archives, private R2 storage, verification, aggregate generation, and intentionally blocked-by-default retention controls.

Install from the repository root with `python -m pip install -e './backend[dev]'`. Operator entry points live in `scripts/`. They expect root `.env` values and never print credential values.

Archive export does not write an archive-manifest record automatically in v1. It returns a complete verified result for an operator/orchestrator to record after the additive `historical_archives` migration is applied. Source passage deletion is not implemented because the checkout lacks the authoritative FK/view definitions needed to prove safety.
