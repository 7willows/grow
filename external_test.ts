import { assertEquals, assertRejects } from "./deps.ts";
import {
  IExternalOne,
  IExternalTwo,
  IInternal,
} from "./examples/external/contracts.ts";
import { grow } from "./mod.ts";

Deno.test("queue", async (t) => {
  const crops = await grow({
    procs: {
      external: {
        cwd: "./examples/external",
        cmd: [
          "node",
          "-r",
          "esbuild-runner/register wrapper.ts",
        ],
      },
    },
    plants: {
      Internal: {
        contracts: [IInternal],
        filePath: "./examples/external/internal.ts",
      },
      ExternalOne: {
        contracts: [IExternalOne],
        proc: "external",
      },
      ExternalTwo: {
        contracts: [IExternalTwo],
        proc: "external",
      },
    },
  });

  const internal = crops.plant<IInternal>("Internal");
  const externalOne = crops.plant<IExternalOne>("ExternalOne");
  const externalTwo = crops.plant<IExternalTwo>("ExternalTwo");

  Deno.test("makes a call to an external source ", async () => {
    const result = await externalTwo.returnOk();
    assertEquals(result, "ok");
  });
});
