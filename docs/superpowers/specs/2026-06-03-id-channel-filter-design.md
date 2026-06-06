# Design: ID@Channel Filter Syntax (Issue #6)

**Date:** 2026-06-03  
**Status:** Approved

## Problem

When two CAN channels carry ECUs with identical arbitration IDs, the existing filter can only globally restrict by channel OR by ID — not per-segment combinations. Users cannot express "show `1A3` on ch0 and `2B5` on ch1" in one filter.

## Solution

Extend the existing comma-delimited ID filter to accept an optional `@channel` suffix per segment.

### Syntax

```
<id>[@<channel>][,<id>[@<channel>]...]
```

Examples:
- `1A3@0` — ID `1A3` on channel 0 only
- `1A3@0,1A3@1` — ID `1A3` on both channels (explicit)
- `1A3@0,2B5@1` — `1A3` on ch0 OR `2B5` on ch1
- `1A3` — existing behavior, all channels (global channel dropdown still applies)

### Filter interaction rules

| Segment type | ID match | Channel match |
|---|---|---|
| `1A3` (no `@`) | substring match against ID representations | global channel dropdown |
| `1A3@0` (with `@`) | substring match against ID representations | channel must equal `0`, global dropdown ignored for this segment |

A message passes the filter if **any** segment matches it.

## Scope of Changes

| File | Change |
|---|---|
| `src/blf-host.ts` | Parse `@channel` from each segment in `applyFilter`. ~15 lines. |
| `src/blf-webview.ts` | Update `#fId` placeholder to `Filter by ID… (e.g. 1A3, 2B5@0)` |

No changes to: `blf-types.ts`, `blf-parser.ts`, `blfViewProvider.ts`, or message protocol.

## Implementation Detail

In `applyFilter`, after splitting `f.id` on commas:

```
for each segment:
  if segment contains '@':
    idPart = segment before '@'
    chPart = segment after '@'
    match = idMatches(m, idPart) AND String(m.channel) === chPart
  else:
    if global channel filter set AND m.channel !== globalChannel: skip
    match = idMatches(m, segment)
```

`idMatches` is the existing substring logic (raw hex, padded 3/8 char, `0x`-prefixed variants).

## Edge Cases

- `@` with empty id part (e.g. `@0`) — matches all IDs on channel 0
- `@` with empty channel part (e.g. `1A3@`) — treat as no channel constraint (fallback to global dropdown)
- Multiple `@` in one segment — only first `@` split used; rest treated as part of channel string (will fail to match any channel, effectively filtering nothing out OR returning false — pick: return no match for malformed input)
- Case: `ch` is 0-based integer in the data; user types `0` or `1` (matches stored value directly)

## Non-Goals

- No query language or boolean operators
- No new UI fields or filter rows
- No per-segment direction or type filtering
