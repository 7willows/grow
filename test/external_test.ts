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
  let externalOne!: IExternalOne;
  let internal!: IInternal;

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
        external2: {
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
          proc: "external2",
        },
      },
    });

    externalTwo = crops.plant("ExternalTwo");
    externalOne = crops.plant("ExternalOne");
    internal = crops.plant("Internal");
  });

  afterAll(() => {
    crops?.kill();
  });

  it("does basic call", async () => {
    const result = await externalTwo.returnOk();
    assertEquals(result, "ok");
  });

  it("can call other services", async () => {
    const result = await externalOne.callExternalTwo();
    assertEquals(result, "ok");
  });

  it("can call internal service from an external one", async () => {
    const result = await externalOne.callInternal();
    assertEquals(result, "world");
  });

  it("can call external service from internal", async () => {
    const result = await internal.callExternalOne();
    assertEquals(result, "bar");
  });
});
