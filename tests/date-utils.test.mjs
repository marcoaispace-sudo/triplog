import test from "node:test";
import assert from "node:assert/strict";
import {formatDateLabel,tripDateRange,tripDayCount,weekdayDateLabel} from "../app/date-utils.ts";

test("date-only trip range never shifts to the previous UTC day",()=>{
  assert.deepEqual(tripDateRange("2026-09-03","2026-09-07"),[
    "2026-09-03","2026-09-04","2026-09-05","2026-09-06","2026-09-07",
  ]);
  assert.equal(tripDayCount("2026-09-03","2026-09-07"),5);
  assert.equal(formatDateLabel("2026-09-03"),"9月3日");
  assert.equal(weekdayDateLabel("2026-09-03"),"週四");
});
