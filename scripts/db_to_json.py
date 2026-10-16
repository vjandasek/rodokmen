"""One-time converter: legacy Family.db (SQLite, WPF app) -> FamTreeWeb/data/family.json.

Usage:
    python3 scripts/db_to_json.py [--db PATH] [--out PATH]

Reads the database strictly read-only. Validates the data and exits non-zero
(without writing) if the tree cannot be built unambiguously.
"""

import argparse
import datetime
import json
import pathlib
import re
import sqlite3
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
DEFAULT_DB = REPO / "FamilyTreeViewer" / "FamilyTreeViewer" / "Database" / "Family.db"
DEFAULT_OUT = HERE.parent / "data" / "family.json"

FORMAT_VERSION = 2

DATE_RE = re.compile(r"^\d{2}\.\d{2}\.\d{4}$")


def is_valid_date(text: str) -> bool:
    """Strict dd.mm.yyyy and a real calendar date."""
    if not DATE_RE.match(text):
        return False
    d, m, y = (int(x) for x in text.split("."))
    try:
        datetime.date(y, m, d)
    except ValueError:
        return False
    return True


def text_or_none(value) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def open_readonly(db_path: pathlib.Path) -> sqlite3.Connection:
    # immutable=1 skips locking, which fails on WSL /mnt/c (drvfs) paths.
    uri = db_path.resolve().as_uri() + "?mode=ro&immutable=1"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def load(conn: sqlite3.Connection) -> tuple[list[dict], list[str]]:
    errors: list[str] = []
    people: dict[int, dict] = {}

    for r in conn.execute(
        "SELECT Id, FirstName, LastName, MaidenName, Sex, BloodRelated, Living,"
        " ParentBlood, ParentNotBlood, Title, BornDate, BornPlace, DeathDate, DeathPlace"
        " FROM FamilyMembers ORDER BY Id"
    ):
        people[r["Id"]] = {
            "id": r["Id"],
            "firstName": r["FirstName"],
            "lastName": r["LastName"],
            "maidenName": r["MaidenName"],
            # Legacy DB stores 1 = male.
            "sex": "M" if r["Sex"] == 1 else "F",
            "living": r["Living"] == 1,
            "bloodRelated": r["BloodRelated"] == 1,
            "parentBlood": r["ParentBlood"],
            "parentNotBlood": r["ParentNotBlood"],
            "partners": [],
            "title": text_or_none(r["Title"]),
            "bornDate": text_or_none(r["BornDate"]),
            "bornPlace": text_or_none(r["BornPlace"]),
            "deathDate": text_or_none(r["DeathDate"]),
            "deathPlace": text_or_none(r["DeathPlace"]),
        }

    for r in conn.execute(
        "SELECT PartnerBlood, PartnerMarried, PartnerShipIndex, Married FROM Relations"
        " ORDER BY PartnerBlood, PartnerShipIndex, Id"
    ):
        blood, partner = r["PartnerBlood"], r["PartnerMarried"]
        if blood not in people or partner not in people:
            errors.append(f"Relation {blood} -> {partner} references a missing person")
            continue
        people[blood]["partners"].append(
            {"id": partner, "married": r["Married"] == 1, "order": r["PartnerShipIndex"]}
        )

    return list(people.values()), errors


def validate(people: list[dict]) -> tuple[int | None, list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    by_id = {p["id"]: p for p in people}
    name = lambda pid: f"{pid} {by_id[pid]['firstName']} {by_id[pid]['lastName'] or ''}".strip()

    partner_of: dict[int, list[int]] = {}
    for p in people:
        for rel in p["partners"]:
            partner_of.setdefault(rel["id"], []).append(p["id"])

    for p in people:
        for key in ("parentBlood", "parentNotBlood"):
            ref = p[key]
            if ref is not None and ref not in by_id:
                errors.append(f"{name(p['id'])}: {key} {ref} does not exist")
        if p["id"] in partner_of and p["bloodRelated"]:
            errors.append(f"{name(p['id'])}: is a partner but marked bloodRelated")
        if len(partner_of.get(p["id"], [])) > 1:
            warnings.append(f"{name(p['id'])}: partner of several people {partner_of[p['id']]}")
        pnb = p["parentNotBlood"]
        pb = p["parentBlood"]
        if pnb is not None and pb is not None and pnb in by_id and pb in by_id:
            if pnb not in [rel["id"] for rel in by_id[pb]["partners"]]:
                warnings.append(
                    f"{name(p['id'])}: parentNotBlood {pnb} is not a partner of parentBlood {pb}"
                )
        if not p["bloodRelated"] and p["id"] not in partner_of:
            warnings.append(f"{name(p['id'])}: not blood-related and not anyone's partner")
        for key in ("bornDate", "deathDate"):
            if p[key] is not None and not is_valid_date(p[key]):
                errors.append(f"Person {p['id']}: {key} {p[key]!r} is not a valid dd.mm.yyyy date")
        if not p["firstName"]:
            warnings.append(f"Person {p['id']}: empty first name")

    roots = [p["id"] for p in people if p["bloodRelated"] and p["parentBlood"] is None]
    root = None
    if len(roots) != 1:
        errors.append(f"Expected exactly one root (blood-related, no parent), found {[name(r) for r in roots]}")
    else:
        root = roots[0]

    # Every blood-related person must reach the root via parentBlood, without cycles.
    for p in people:
        if not p["bloodRelated"]:
            continue
        seen = set()
        cur = p["id"]
        while cur is not None and cur not in seen:
            seen.add(cur)
            cur = by_id[cur]["parentBlood"] if cur in by_id else None
        if cur is not None:
            errors.append(f"{name(p['id'])}: parentBlood chain contains a cycle")
        elif root is not None and root not in seen:
            errors.append(f"{name(p['id'])}: not connected to the root")

    return root, errors, warnings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", type=pathlib.Path, default=DEFAULT_DB)
    ap.add_argument("--out", type=pathlib.Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    if not args.db.exists():
        print(f"Database not found: {args.db}", file=sys.stderr)
        return 1

    with open_readonly(args.db) as conn:
        people, errors = load(conn)
    root, v_errors, warnings = validate(people)
    errors += v_errors

    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"error: {e}", file=sys.stderr)
    if errors:
        print("Not written: fix the errors above first.", file=sys.stderr)
        return 1

    doc = {"version": FORMAT_VERSION, "rootId": root, "people": people}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    partners = sum(len(p["partners"]) for p in people)
    print(f"Wrote {args.out}: {len(people)} people, {partners} partnerships, root {root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
