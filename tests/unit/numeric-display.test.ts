import { test, expect } from "vitest";
import { displayNumber } from "../../packages/react/src/numeric-field";
test("display rounds without modifying the internal values and represents unknown as blank", () => {
  const values = [
    25.400000000000002,
    210.000555555,
    0,
    -3.52777777778,
    undefined,
    NaN,
  ];
  const before = [...values];
  expect(values.map(displayNumber)).toEqual([
    "25.4",
    "210",
    "0",
    "-3.53",
    "",
    "",
  ]);
  expect(values).toEqual(before);
});
