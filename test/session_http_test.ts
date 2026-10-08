import { assertEquals } from "https://deno.land/std@0.184.0/testing/asserts.ts";
import { Crops, grow } from "../mod.ts";
import * as whoAmIService from "./services/whoami.ts";

/**
 * Sesja żądania HTTP: domyślnie z nagłówka `grow-session-id`; `initCtx` może
 * ją podmienić (np. odczytać z ciasteczka HttpOnly) i plant widzi wynik.
 */

// Funkcja, nie stała: grow() zamienia filePath na ścieżkę bezwzględną w miejscu.
const plants = () => ({
  WhoAmI: {
    filePath: "./services/whoami.ts",
    contracts: [whoAmIService.IWhoAmI],
    http: true,
  },
});

async function start(port: number, initCtx?: any): Promise<Crops> {
  Deno.env.set("GROW_PORT", String(port));
  return await grow(
    { plants: plants(), ...(initCtx ? { initCtx } : {}) } as any,
  );
}

async function whoAmI(port: number, headers: Record<string, string>) {
  const res = await fetch(`http://localhost:${port}/who-am-i/who-am-i`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "[]",
  });
  const body = await res.json();
  return body.result ?? body;
}

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("sesja z nagłówka, bez initCtx — jak dotąd", opts, async (t) => {
  const port = 18411;
  const services = await start(port);
  try {
    await t.step("nagłówek trafia do planta", async () => {
      assertEquals(
        await whoAmI(port, { "grow-session-id": "hdr-1" }),
        "hdr-1",
      );
    });
    await t.step("samo ciasteczko jest ignorowane", async () => {
      assertEquals(await whoAmI(port, { cookie: "sid=cookie-1" }), "");
    });
  } finally {
    services.kill();
  }
});

Deno.test("initCtx podmienia sesję", opts, async (t) => {
  const port = 18412;
  // Nagłówek wygrywa, chyba że to przestarzała wartość („stale:…") — wtedy ciasteczko.
  const services = await start(port, (c: any, ctx: any) => {
    const m = c?.req.header("cookie")?.match(/(?:^|;\s*)sid=([^;]*)/);
    if (!m || (ctx.sessionId && !ctx.sessionId.startsWith("stale:"))) {
      return ctx;
    }
    return { ...ctx, sessionId: m[1] };
  });
  try {
    await t.step("sesja z ciasteczka, gdy brak nagłówka", async () => {
      assertEquals(await whoAmI(port, { cookie: "sid=cookie-2" }), "cookie-2");
    });
    await t.step("nagłówek nadal ma pierwszeństwo", async () => {
      assertEquals(
        await whoAmI(port, { "grow-session-id": "hdr-2", cookie: "sid=x" }),
        "hdr-2",
      );
    });
    await t.step("initCtx może zastąpić sesję z nagłówka", async () => {
      assertEquals(
        await whoAmI(port, { "grow-session-id": "stale:x", cookie: "sid=c-3" }),
        "c-3",
      );
    });
  } finally {
    services.kill();
  }
});
