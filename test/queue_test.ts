import { assertEquals } from "../deps.ts";
import { grow } from "../mod.ts";
import { IPublisher, ISubscriber } from "../examples/queue/contract.ts";

Deno.test("queue", async (t) => {
  const crops = await grow({
    plants: {
      Publisher: {
        contracts: [IPublisher],
        filePath: "../examples/queue/publisher.ts",
      },
      Subscriber: {
        contracts: [ISubscriber],
        filePath: "../examples/queue/subscriber.ts",
      },
    },
  });

  const publisher = crops.plant<IPublisher>("Publisher");
  const subscriber = crops.plant<ISubscriber>("Subscriber");

  await t.step("@caller", async () => {
    const result = await subscriber.goAndSubscribe();
    assertEquals(result, "subscriber");
  });

  await t.step("@on()", async () => {
    await subscriber.goAndSubscribe();
    await publisher.publish();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const v = await subscriber.whatIsFoo();

    assertEquals(v, "bar");
  });

  await t.step("@queue()", async () => {
    await publisher.changeName();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const who = await subscriber.whoami();

    assertEquals(who, "changed");
  });

  await crops.kill();
});
