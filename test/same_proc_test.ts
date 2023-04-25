import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.184.0/testing/asserts.ts";
import { Crops, grow } from "../mod.ts";
import {
  afterAll,
  beforeAll,
  describe,
  it,
} from "https://deno.land/std@0.184.0/testing/bdd.ts";
import * as helloService from "./services/hello.ts";
import * as nameService from "./services/name.ts";

describe("WorkflowAccess", () => {
  let services: Crops;
  let hello!: helloService.IHello;
  let name!: nameService.IName;

  beforeAll(async () => {
    services = await grow({
      plants: {
        Hello: {
          filePath: "./services/hello.ts",
          contracts: [helloService.IHello],
          proc: "main",
        },
        Name: {
          filePath: "./services/name.ts",
          contracts: [nameService.IName],
          proc: "main",
        },
      },
    });

    hello = services.plant("Hello");
    name = services.plant("Name");
  });

  afterAll(async () => {
    services.kill();
  });

  it("communicates", async () => {
    nameService.Name.prototype.getName = function () {
      return Promise.resolve("John");
    };

    helloService.Hello.prototype.sayHello = async function () {
      const name = await this.name.getName();
      return `HELLO ${name}!`;
    };

    const result = await hello.sayHello();
    assertEquals(result, "HELLO John!");
  });
});
