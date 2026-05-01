from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = ROOT / "skills"


def parse_frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---\n"):
        raise ValueError("missing YAML frontmatter start")

    try:
        _, frontmatter, _ = text.split("---\n", 2)
    except ValueError as error:
        raise ValueError("invalid YAML frontmatter block") from error

    data: dict[str, str] = {}
    for raw_line in frontmatter.splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip().strip('"')
    return data


def validate_skill_dir(skill_dir: Path) -> list[str]:
    errors: list[str] = []
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        return [f"{skill_dir.name}: missing SKILL.md"]

    text = skill_file.read_text(encoding="utf-8")
    try:
        frontmatter = parse_frontmatter(text)
    except ValueError as error:
        return [f"{skill_dir.name}: {error}"]

    for field in ("name", "description"):
        if not frontmatter.get(field):
            errors.append(f"{skill_dir.name}: missing frontmatter field '{field}'")

    evals_file = skill_dir / "evals" / "evals.json"
    if evals_file.exists():
        try:
            payload = json.loads(evals_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            errors.append(f"{skill_dir.name}: invalid evals.json: {error}")
            return errors

        if payload.get("skill_name") != frontmatter.get("name"):
            errors.append(
                f"{skill_dir.name}: evals skill_name does not match frontmatter name"
            )

        evals = payload.get("evals")
        if not isinstance(evals, list) or not evals:
            errors.append(f"{skill_dir.name}: evals.json must contain a non-empty 'evals' list")
            return errors

        for index, item in enumerate(evals, start=1):
            if not isinstance(item, dict):
                errors.append(f"{skill_dir.name}: eval #{index} is not an object")
                continue
            for field in ("id", "prompt", "expected_output", "files"):
                if field not in item:
                    errors.append(f"{skill_dir.name}: eval #{index} missing '{field}'")

    return errors


def main() -> int:
    if not SKILLS_DIR.exists():
        print("skills directory not found", file=sys.stderr)
        return 1

    all_errors: list[str] = []
    for skill_dir in sorted(path for path in SKILLS_DIR.iterdir() if path.is_dir()):
        all_errors.extend(validate_skill_dir(skill_dir))

    if all_errors:
        for error in all_errors:
            print(f"ERROR: {error}")
        return 1

    print(f"Validated {sum(1 for path in SKILLS_DIR.iterdir() if path.is_dir())} skill(s) successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())