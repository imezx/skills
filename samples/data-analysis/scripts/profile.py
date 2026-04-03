import sys
import csv
from pathlib import Path
from collections import Counter

INPUT_FILE = "data.csv"


def load_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        return reader.fieldnames or [], rows


def try_float(v):
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def profile_column(name, values):
    non_null = [v for v in values if v not in ("", None)]
    null_count = len(values) - len(non_null)

    numerics = [try_float(v) for v in non_null]
    numerics = [n for n in numerics if n is not None]

    result = {
        "column": name,
        "total": len(values),
        "non_null": len(non_null),
        "null_count": null_count,
        "null_pct": round(null_count / len(values) * 100, 2) if values else 0,
        "unique": len(set(non_null)),
    }

    if len(numerics) >= len(non_null) * 0.8:
        result["type"] = "numeric"
        result["min"] = min(numerics)
        result["max"] = max(numerics)
        result["mean"] = round(sum(numerics) / len(numerics), 4)
        sorted_n = sorted(numerics)
        mid = len(sorted_n) // 2
        result["median"] = (
            sorted_n[mid]
            if len(sorted_n) % 2
            else (sorted_n[mid - 1] + sorted_n[mid]) / 2
        )
        variance = sum((x - result["mean"]) ** 2 for x in numerics) / len(numerics)
        result["std"] = round(variance**0.5, 4)
        p25_i = int(len(sorted_n) * 0.25)
        p75_i = int(len(sorted_n) * 0.75)
        result["p25"] = sorted_n[p25_i]
        result["p75"] = sorted_n[p75_i]
    else:
        result["type"] = "categorical"
        top = Counter(non_null).most_common(5)
        result["top_values"] = [{"value": v, "count": c} for v, c in top]

    return result


def detect_duplicates(rows):
    seen = set()
    dupes = 0
    for row in rows:
        key = tuple(sorted(row.items()))
        if key in seen:
            dupes += 1
        seen.add(key)
    return dupes


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else INPUT_FILE
    columns, rows = load_csv(path)

    print(f"\nDataset: {Path(path).name}")
    print(f"Rows: {len(rows)}")
    print(f"Columns: {len(columns)}")
    print(f"Duplicates: {detect_duplicates(rows)}")
    print()

    for col in columns:
        values = [row.get(col, "") for row in rows]
        p = profile_column(col, values)
        print(f"[{p['type'].upper()}] {p['column']}")
        print(f"  nulls: {p['null_count']} ({p['null_pct']}%)  unique: {p['unique']}")
        if p["type"] == "numeric":
            print(
                f"  min={p['min']}  max={p['max']}  mean={p['mean']}  median={p['median']}  std={p['std']}"
            )
            print(f"  p25={p['p25']}  p75={p['p75']}")
        else:
            top_str = ", ".join(f"{t['value']} ({t['count']})" for t in p["top_values"])
            print(f"  top: {top_str}")
        print()


if __name__ == "__main__":
    main()
