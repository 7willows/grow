import { assertEquals } from "https://deno.land/std@0.184.0/testing/asserts.ts";
import { Crops, grow } from "../mod.ts";
import {
  afterAll,
  beforeAll,
  describe,
  it,
} from "https://deno.land/std@0.184.0/testing/bdd.ts";
import * as helloService from "./services/hello.ts";
import * as nameService from "./services/name.ts";

describe("Basic test", () => {
  let services: Crops;
  let hello!: helloService.IHello;
  let name!: nameService.IName;

  beforeAll(async () => {
    services = await grow({
      plants: {
        Hello: {
          filePath: "./services/hello.ts",
          contracts: [helloService.IHello],
        },
        Name: {
          filePath: "./services/name.ts",
          contracts: [nameService.IName],
        },
      },
    });

    hello = services.plant("Hello");
    name = services.plant("Name");
  });

  afterAll(() => {
    services.kill();
  });

  it("communicates", async () => {
    const result = await hello.sayHello();
    assertEquals(result, "Hello Tester!");
  });

  it.ignore("can mutate state", async () => {
    name.setName("John");

    const result = await hello.sayHello();

    assertEquals(result, "Hello John!");
  });
});
