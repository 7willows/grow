import { grow } from "./mod.ts";
import { IAccess, IManager } from "./examples/simple/contract.ts";

async function startGrow() {
  return await grow({
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

const crops = await startGrow();
const manager = crops.plant<IManager>("Manager", "ROOT");

Deno.bench(async function zero() {
  for (let i = 0; i < 1000; i++) {
    await manager.getSession();
  }
});

Deno.bench(async function getSession() {
  for (let i = 0; i < 1000; i++) {
    await manager.getSession();
  }
});

Deno.bench(async function listItems() {
  for (let i = 0; i < 1000; i++) {
    await manager.listItems("ok");
  }
});
