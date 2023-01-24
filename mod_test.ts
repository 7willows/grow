import { assertEquals } from "./deps.ts";
import { grow } from "./mod.ts";
import { IAccess, IManager } from "./examples/simple/contract.ts";

Deno.test("basic field", async () => {
  const crops = await startGrow();
  const result = await crops.plant<IManager>("Manager").listItems("ok");

  assertEquals(result.length, 2);

  crops.kill();
});

Deno.test("sessionId", async () => {
  const crops = await startGrow();

  try {
    const result = await crops.plant<IManager>("Manager", "ABC").getSession();
    assertEquals(result, "ABC");
  } catch (err) {
    console.error(err);
  } finally {
    crops.kill();
  }
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
