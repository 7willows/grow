import { assertEquals } from "./deps.ts";
import {
  IExternalOne,
  IExternalTwo,
  IInternal,
} from "./examples/external/contracts.ts";
import { grow } from "./mod.ts";
import {
  afterAll,
  beforeAll,
  describe,
  it,
} from "https://deno.land/std@0.184.0/testing/bdd.ts";

describe("external", () => {
  let crops: any;
  let externalTwo!: IExternalTwo;

  beforeAll(async () => {
    crops = await grow({
      procs: {
        external: {
          cwd: "./examples/external",
          cmd: [
            "node",
            "wrapper.js",
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

    externalTwo = crops.plant("ExternalTwo");
  });

  afterAll(() => {
    crops?.kill();
  });

  // const internal = crops.plant<IInternal>("Internal");
  // const externalOne = crops.plant<IExternalOne>("ExternalOne");
  it("does basic call", async () => {
    console.log("start--------------------");

    const result = await externalTwo.returnOk();
    console.log("done");
    assertEquals(result, "ok");
  });
});
