import { assertEquals, assertRejects } from "./deps.ts";
import { grow } from "./mod.ts";
import { IPublisher, ISubscriber } from "./examples/queue/contract.ts";

Deno.test("queue", async (t) => {
  const crops = await grow({
    plants: {
      Publisher: {
        contracts: [IPublisher],
        filePath: "./examples/queue/publisher.ts",
      },
      Subscriber: {
        contracts: [ISubscriber],
        filePath: "./examples/queue/subscriber.ts",
      },
    },
  });

  await t.step("@caller", async () => {
    const result = await crops.plant<any>("Subscriber").goAndSubscribe();

    assertEquals(result, "subscriber");
  });

  await crops.kill();
});
