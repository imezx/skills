import sys
import csv
import math
from pathlib import Path

INPUT_FILE = "data.csv"


def load_numeric_columns(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fields = reader.fieldnames or []

    numeric = {}
    for field in fields:
        vals = []
        for row in rows:
            try:
                vals.append(float(row[field]))
            except (ValueError, TypeError):
                vals.append(None)
        non_null = [v for v in vals if v is not None]
        if len(non_null) >= len(rows) * 0.5:
            numeric[field] = vals
    return numeric


def pearson(xs, ys):
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    if len(pairs) < 3:
        return None
    n = len(pairs)
    mx = sum(p[0] for p in pairs) / n
    my = sum(p[1] for p in pairs) / n
    num = sum((p[0] - mx) * (p[1] - my) for p in pairs)
    dx = math.sqrt(sum((p[0] - mx) ** 2 for p in pairs))
    dy = math.sqrt(sum((p[1] - my) ** 2 for p in pairs))
    if dx == 0 or dy == 0:
        return None
    return round(num / (dx * dy), 4)


def rank(vals):
    non_null = [(v, i) for i, v in enumerate(vals) if v is not None]
    sorted_vals = sorted(non_null, key=lambda x: x[0])
    ranks = [0.0] * len(vals)
    for rank_pos, (_, orig_i) in enumerate(sorted_vals):
        ranks[orig_i] = rank_pos + 1
    return ranks


def spearman(xs, ys):
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    if len(pairs) < 3:
        return None
    rx = rank([p[0] for p in pairs])
    ry = rank([p[1] for p in pairs])
    return pearson(rx, ry)


def strength_label(r):
    if r is None:
        return "n/a"
    a = abs(r)
    if a >= 0.9:
        return "very strong"
    if a >= 0.7:
        return "strong"
    if a >= 0.5:
        return "moderate"
    if a >= 0.3:
        return "weak"
    return "negligible"


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else INPUT_FILE
    cols = load_numeric_columns(path)
    names = list(cols.keys())

    if len(names) < 2:
        print("Need at least 2 numeric columns for correlation analysis.")
        return

    print(f"\nCorrelation matrix - {Path(path).name}")
    print(f"Numeric columns: {', '.join(names)}\n")

    pairs = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            p = pearson(cols[a], cols[b])
            s = spearman(cols[a], cols[b])
            pairs.append((a, b, p, s))

    pairs.sort(key=lambda x: abs(x[2]) if x[2] is not None else 0, reverse=True)

    print(
        f"{'Column A':<25} {'Column B':<25} {'Pearson':>10} {'Spearman':>10} {'Strength':<15}"
    )
    print("-" * 90)
    for a, b, p, s in pairs:
        p_str = f"{p:.4f}" if p is not None else "n/a"
        s_str = f"{s:.4f}" if s is not None else "n/a"
        print(f"{a:<25} {b:<25} {p_str:>10} {s_str:>10} {strength_label(p):<15}")

    print()
    strong = [(a, b, p) for a, b, p, _ in pairs if p is not None and abs(p) >= 0.5]
    if strong:
        print("Notable correlations (|r| >= 0.5):")
        for a, b, p in strong:
            direction = "positive" if p > 0 else "negative"
            print(f"  {a} <-> {b}: {p:.4f} ({direction}, {strength_label(p)})")
    else:
        print("No strong correlations found (|r| < 0.5 for all pairs).")


if __name__ == "__main__":
    main()
