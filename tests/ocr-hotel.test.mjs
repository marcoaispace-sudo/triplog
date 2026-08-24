import test from "node:test";
import assert from "node:assert/strict";
import {extractOcrFields} from "../app/ocr.ts";

test("extracts labeled hotel and stay details before online lookup",()=>{
  const result=extractOcrFields(`
Hotel name: Shilla Stay Mapo
Address: 83 Mapo-daero, Mapo-gu, Seoul 04156
Postal code: 04156
Phone: +82 2-6979-9000
Check-in: 2026-09-03 15:00
Check-out: 2026-09-07 12:00
  `);
  assert.equal(result.hotelName,"Shilla Stay Mapo");
  assert.equal(result.postalCode,"04156");
  assert.equal(result.checkInDate,"2026-09-03");
  assert.equal(result.checkInTime,"15:00");
  assert.equal(result.checkOutDate,"2026-09-07");
  assert.equal(result.checkOutTime,"12:00");
});
