import { expect, it } from "vitest";
import fixtures from "../../packages/template/contracts/v3/fixtures/plans.json";
import * as template from "../../packages/template/src/index";
for (const fixture of fixtures)
  it(fixture.name, async () => {
    if (fixture.error)
      await expect(
        template.validateRenderPlanV3(fixture.input as never),
      ).rejects.toThrow(fixture.error);
    else {
      const validated = await template.validateRenderPlanV3(
        fixture.input as never,
      );
      expect(validated.planDigest).toBe(fixture.planDigest);
      expect(validated.plan).toEqual(fixture.input.plan);
    }
  });
