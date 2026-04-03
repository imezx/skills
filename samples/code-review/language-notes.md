# Language-Specific Review Notes

Reference this file during code review for language-specific pitfalls.

---

## Python

- Mutable default arguments: `def f(x=[])` - the list is shared across all calls. Fix: `def f(x=None): x = x or []`
- Bare `except:` catches `SystemExit` and `KeyboardInterrupt`. Always use `except Exception:` at minimum.
- `is` vs `==` - `is` checks identity, not equality. Never use `is` to compare strings or integers outside of `None` checks.
- `open()` without `with` - file handles leak. Always use context manager.
- f-strings with side effects inside: `f"{counter.increment()}"` - avoid.
- `threading.Thread` without `daemon=True` blocks process exit.

## JavaScript / TypeScript

- `==` instead of `===` - always use strict equality.
- `async` functions that are not awaited silently swallow errors.
- `Promise.all` fails fast - unhandled rejections in parallel tasks crash the whole batch.
- `JSON.parse` without try/catch throws on malformed input.
- Mutating function parameters directly - causes hard-to-trace bugs.
- `Array.prototype.sort()` without comparator sorts lexicographically, not numerically.
- TypeScript: `any` types that could be `unknown` - forces callers to narrow before use.

## Go

- Missing `context.Context` propagation in long-running operations - no cancellation support.
- `defer` inside a loop runs at function exit, not loop iteration - causes resource leaks.
- Ignoring the second return value of a map lookup: `v := m[k]` - `v` is zero value if missing.
- Goroutine leaks from channels that are never closed.
- `time.Sleep` in tests - use channels or `sync.WaitGroup` instead.

## Rust

- `.unwrap()` in production code - should be `?` or explicit error handling.
- `.clone()` used to satisfy the borrow checker instead of fixing the ownership model.
- `unsafe` blocks without a safety comment explaining the invariants.
- Integer overflow in debug mode panics, in release mode wraps - use checked arithmetic for untrusted input.

## SQL

- String interpolation into queries - always use parameterised queries.
- `SELECT *` in production code - columns added later silently break assumptions.
- Missing index on foreign key columns used in JOINs.
- `DELETE` or `UPDATE` without `WHERE` clause.
- Transactions without explicit rollback on error.
