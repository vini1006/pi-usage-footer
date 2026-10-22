import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUsage } from "./usage.ts";

const five = { utilization: 32, resets_at: "2026-10-21T12:10:00Z" };
const week = { utilization: 48, resets_at: "2026-10-24T10:00:00Z" };

test("maps windows to percent units and epoch ms", () => {
  assert.deepEqual(parseUsage({ five_hour: five, seven_day: week, extra_usage: null }), {
    fiveHour: { used: 32, resetsAt: Date.parse(five.resets_at) },
    sevenDay: { used: 48, resetsAt: Date.parse(week.resets_at) },
  });
});

test("missing windows are unknown, not invented zeroes", () => {
  assert.deepEqual(parseUsage({ five_hour: null, seven_day: week }).fiveHour, undefined);
});

for (const value of [undefined, null, [], {}, { five_hour: null }, { five_hour: { ...five, utilization: "32" } }, { five_hour: { ...five, utilization: -1 } }, { five_hour: { ...five, utilization: 101 } }, { five_hour: { ...five, utilization: NaN } }, { five_hour: { ...five, utilization: Infinity } }, { five_hour: { ...five, resets_at: "bad-date" } }, { five_hour: { ...five, resets_at: 0 } }]) {
  test(`rejects missing/malformed usage ${JSON.stringify(value)}`, () => {
    assert.throws(() => parseUsage(value), /Invalid usage response/);
  });
}

test("malformed supplied window does not hide behind a valid other window", () => {
  assert.throws(() => parseUsage({ five_hour: { utilization: "32", resets_at: five.resets_at }, seven_day: week }), /Invalid usage response/);
});
