import { assertEquals } from "std/testing/asserts.ts";
import { grow } from "./mod.ts";
import { IAccess, IManager } from "./examples/simple/contract.ts";

Deno.test("basic field", async () => {
  const app = await startGrow();
  const result = await app.proxy<IManager>("Manager").listItems();

  assertEquals(result.length, 2);

  app.stop();
});

function startGrow() {
  return grow({
    plants: {
      Manager: {
        contracts: [IManager],
        filePath: "./examples/simple/manager.ts",
      },
      Access: {
        contracts: [IAccess],
        filePath: "./examples/simple/access.ts",
        config: {
          url: "OK",
        },
      },
    },
  });
}
