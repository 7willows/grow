import { IExternalOne, IExternalTwo, IInternal } from "./external/contracts.ts";
import { grow } from "../mod.ts";
import {
  afterAll,
  assertEquals,
  beforeAll,
  describe,
  dirname,
  it,
} from "../deps.ts";

describe("external", () => {
  let crops: any;
  let externalTwo!: IExternalTwo;

  beforeAll(async () => {
    const dir = dirname(import.meta).__dirname;

    crops = await grow({
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
        Internal: {
          contracts: [IInternal],
          filePath: "./external/internal.ts",
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
