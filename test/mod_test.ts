import { assertEquals, assertRejects } from "../deps.ts";
import { grow } from "../mod.ts";
import { IAccess, IManager } from "../examples/simple/contract.ts";

async function startGrow() {
  return await grow({
    plants: {
      Manager: {
        contracts: [IManager],
        filePath: "../examples/simple/manager.ts",
      },
      Access: {
        contracts: [IAccess],
        filePath: "../examples/simple/access.ts",
        config: {
          url: "OK",
        },
      },
    },
  });
}

Deno.test("grow", async (t) => {
  const crops = await startGrow();

  await t.step("basic load data", async () => {
    const result = await crops.plant<IManager>("Manager").listItems("ok");
    assertEquals(result.length, 2);
  });

  await t.step("sessionId", async () => {
    const result = await crops.plant<IManager>("Manager", "ABC").getSession();
    assertEquals(result, "ABC");
  });

  await t.step("exception is not crushing the program", async () => {
    await assertRejects(() => crops.plant<IManager>("Manager").throwErr());
    const result = await crops.plant<IManager>("Manager", "ABC").getSession();
    assertEquals(result, "ABC");
  });

  crops.kill();
});
