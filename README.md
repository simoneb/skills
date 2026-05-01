# Personal Skills

This repository stores my reusable agent skills.

## Structure

- `skills/` contains one directory per skill.
- `scripts/` contains small utilities to validate or maintain the collection.

## Current Skills

- `curvo-backtest-workflows`: build, compare, and validate ETF portfolios on Curvo Backtest with a bias toward deterministic URL- or script-driven workflows.

## Validation

Run:

```powershell
python scripts/validate_skills.py
```

This checks that each skill has:

- a `SKILL.md` file,
- YAML frontmatter with `name` and `description`,
- valid `evals/evals.json` structure when present.

## Notes

This repo is meant to be a personal collection, so the layout is intentionally simple and easy to extend.
