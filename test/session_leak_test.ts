import { assertEquals } from "https://deno.land/std@0.184.0/testing/asserts.ts";
import {
  afterAll,
  beforeAll,
  describe,
  it,
} from "https://deno.land/std@0.184.0/testing/bdd.ts";
import { Crops, grow } from "../mod.ts";
import * as askerService from "./services/asker.ts";
import * as whoAmIService from "./services/whoami.ts";

/**
 * Kontekst żądania (sessionId/requestId) musi żyć per wywołanie.
 * Jeżeli wycieka między równoczesnymi wywołaniami, wstrzyknięty serwis
 * zobaczy sesję cudzego żądania.
 */
describe("kontekst sesji przy równoczesnych wywołaniach", () => {
  let services: Crops;

  beforeAll(async () => {
    services = await grow({
      plants: {
        Asker: {
          filePath: "./services/asker.ts",
          contracts: [askerService.IAsker],
        },
        WhoAmI: {
          filePath: "./services/whoami.ts",
          contracts: [whoAmIService.IWhoAmI],
        },
      },
    });
  });

  afterAll(() => {
    services.kill();
  });

  it("nie miesza sesji dwóch równoczesnych żądań", async () => {
    const slow: askerService.IAsker = services.plant("Asker", "session-A");
    const fast: askerService.IAsker = services.plant("Asker", "session-B");

    // A czeka 150 ms przed wywołaniem wstrzykniętego serwisu; B wchodzi
    // w międzyczasie i kończy się przed nim.
    const [a, b] = await Promise.all([
      slow.ask(150),
      fast.ask(0),
    ]);

    assertEquals(a, { own: "session-A", seen: "session-A" });
    assertEquals(b, { own: "session-B", seen: "session-B" });
  });

  it("nie miesza sesji przy większej równoczesności", async () => {
    const calls = Array.from({ length: 10 }, (_, i) => {
      const sid = `session-${i}`;
      const plant: askerService.IAsker = services.plant("Asker", sid);
      return plant.ask((10 - i) * 20).then((r) => ({ sid, ...r }));
    });

    const results = await Promise.all(calls);

    for (const r of results) {
      assertEquals(r.own, r.sid);
      assertEquals(r.seen, r.sid, `wyciek: ${r.sid} zobaczył ${r.seen}`);
    }
  });
});
