import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUsage, formatUsage } from "./usage.ts";

const now = Date.parse("2026-10-21T10:00:00Z");
const five = { utilization: 32, resets_at: "2026-10-21T12:10:00Z" };
const week = { utilization: 48, resets_at: "2026-10-24T10:00:00Z" };

// Catches fraction-to-percent conversion and swapped/missing quota windows.
test("formats real percentages and independently calculated reset countdowns", () => {
  const usage = parseUsage({ five_hour: five, seven_day: week, extra_usage: null });
  assert.equal(formatUsage(usage, now), "Claude 5h 32% ↻2h10m | 7d 48% ↻3d");
});

for (const [used, expected] of [[0, "0%"], [0.5, "0.5%"], [1, "1%"], [99.95, "100%"], [100, "100%"]] as const) {
  test(`keeps utilization ${used} in percent units`, () => {
    const usage = parseUsage({ five_hour: { ...five, utilization: used } });
    assert.equal(formatUsage(usage, now), `Claude 5h ${expected} ↻2h10m | 7d —`);
  });
}

test("missing windows are unknown, not invented zeroes", () => {
  assert.equal(formatUsage(parseUsage({ five_hour: null, seven_day: week }), now), "Claude 5h — | 7d 48% ↻3d");
});

for (const value of [undefined, null, [], {}, { five_hour: null }, { five_hour: { ...five, utilization: "32" } }, { five_hour: { ...five, utilization: -1 } }, { five_hour: { ...five, utilization: 101 } }, { five_hour: { ...five, utilization: NaN } }, { five_hour: { ...five, utilization: Infinity } }, { five_hour: { ...five, resets_at: "bad-date" } }, { five_hour: { ...five, resets_at: 0 } }]) {
  test(`rejects missing/malformed usage ${JSON.stringify(value)}`, () => {
    assert.throws(() => parseUsage(value), /Invalid usage response/);
  });
}

test("malformed supplied window does not hide behind a valid other window", () => {
  assert.throws(() => parseUsage({ five_hour: { utilization: "32", resets_at: five.resets_at }, seven_day: week }), /Invalid usage response/);
});

test("expired window never displays its old percentage as current", () => {
  const usage = parseUsage({ five_hour: five, seven_day: week });
  assert.equal(formatUsage(usage, Date.parse("2026-10-21T12:10:00Z")), "Claude 5h 갱신 대기 | 7d 48% ↻2d21h");
});

test("countdowns round up sub-minute time instead of resetting early", () => {
  const usage = parseUsage({ five_hour: { ...five, resets_at: "2026-10-21T10:00:01Z" } });
  assert.equal(formatUsage(usage, now), "Claude 5h 32% ↻1m | 7d —");
});
