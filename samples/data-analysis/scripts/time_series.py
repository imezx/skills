import sys
import csv
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict

INPUT_FILE = "data.csv"
DATE_COLUMN = "date"
VALUE_COLUMN = "value"
RESAMPLE_PERIOD = "month"

FORMATS = [
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%d-%m-%Y",
    "%Y/%m/%d",
]


def parse_date(s):
    for fmt in FORMATS:
        try:
            return datetime.strptime(s.strip(), fmt)
        except (ValueError, AttributeError):
            continue
    return None


def period_key(dt, period):
    if period == "day":
        return dt.strftime("%Y-%m-%d")
    if period == "week":
        monday = dt - timedelta(days=dt.weekday())
        return monday.strftime("%Y-W%W")
    if period == "month":
        return dt.strftime("%Y-%m")
    if period == "quarter":
        q = (dt.month - 1) // 3 + 1
        return f"{dt.year}-Q{q}"
    if period == "year":
        return str(dt.year)
    return dt.strftime("%Y-%m")


def rolling_average(values, window):
    result = []
    for i in range(len(values)):
        start = max(0, i - window + 1)
        window_vals = values[start : i + 1]
        result.append(sum(window_vals) / len(window_vals))
    return result


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else INPUT_FILE
    date_col = sys.argv[2] if len(sys.argv) > 2 else DATE_COLUMN
    value_col = sys.argv[3] if len(sys.argv) > 3 else VALUE_COLUMN
    period = sys.argv[4] if len(sys.argv) > 4 else RESAMPLE_PERIOD

    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    if date_col not in (reader.fieldnames or []):
        print(f"Date column '{date_col}' not found. Available: {reader.fieldnames}")
        return
    if value_col not in (reader.fieldnames or []):
        print(f"Value column '{value_col}' not found. Available: {reader.fieldnames}")
        return

    series = []
    skipped = 0
    for row in rows:
        dt = parse_date(row[date_col])
        try:
            v = float(row[value_col])
        except (ValueError, TypeError):
            skipped += 1
            continue
        if dt is None:
            skipped += 1
            continue
        series.append((dt, v))

    series.sort(key=lambda x: x[0])

    if not series:
        print("No valid date/value pairs found after parsing.")
        return

    print(f"\nTime Series Analysis - {Path(path).name}")
    print(f"Date column: {date_col}  Value column: {value_col}")
    print(f"Period: {period}  Valid rows: {len(series)}  Skipped: {skipped}")
    print(f"Date range: {series[0][0].date()} -> {series[-1][0].date()}\n")

    buckets = defaultdict(list)
    for dt, v in series:
        buckets[period_key(dt, period)].append(v)

    keys = sorted(buckets.keys())
    bucket_means = [sum(buckets[k]) / len(buckets[k]) for k in keys]
    bucket_sums = [sum(buckets[k]) for k in keys]
    counts = [len(buckets[k]) for k in keys]

    ra3 = rolling_average(bucket_means, 3)

    print(f"{'Period':<15} {'Count':>7} {'Sum':>14} {'Mean':>12} {'3-period MA':>12}")
    print("-" * 65)
    for i, k in enumerate(keys):
        print(
            f"{k:<15} {counts[i]:>7} {bucket_sums[i]:>14.2f} {bucket_means[i]:>12.2f} {ra3[i]:>12.2f}"
        )

    all_means = bucket_means
    if len(all_means) >= 2:
        first_half = all_means[: len(all_means) // 2]
        second_half = all_means[len(all_means) // 2 :]
        first_avg = sum(first_half) / len(first_half)
        second_avg = sum(second_half) / len(second_half)
        change_pct = (
            ((second_avg - first_avg) / abs(first_avg) * 100) if first_avg != 0 else 0
        )
        direction = "up" if change_pct > 0 else "down"
        print(
            f"\nOverall trend: {direction} {abs(change_pct):.1f}% (first half avg: {first_avg:.2f} -> second half avg: {second_avg:.2f})"
        )

    peak_k = keys[bucket_means.index(max(bucket_means))]
    trough_k = keys[bucket_means.index(min(bucket_means))]
    print(f"Peak period:   {peak_k} (mean: {max(bucket_means):.2f})")
    print(f"Trough period: {trough_k} (mean: {min(bucket_means):.2f})")


if __name__ == "__main__":
    main()
