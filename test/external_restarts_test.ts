import { IExternalTwo } from "./external/contracts.ts";
import { grow } from "../mod.ts";
import { assertEquals, dirname } from "../deps.ts";

Deno.test("restarts after a crash", async () => {
  const dir = dirname(import.meta).__dirname;

  const crops = await grow({
    procs: {
      external: {
        cwd: dir + "/external",
        cmd: [
          "node",
          "wrapper.js",
        ],
      },
    },
    plants: {
      ExternalTwo: {
        contracts: [IExternalTwo],
        proc: "external",
      },
    },
  });

  const externalTwo: IExternalTwo = crops.plant("ExternalTwo");
  await externalTwo.crash().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 100));
  const result = await externalTwo.returnOk();

  assertEquals(result, "ok");

  crops?.kill();
});
