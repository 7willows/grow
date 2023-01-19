import { grow } from "../../mod.ts";
import { IAccess, IManager } from "./contract.ts";
import { serveStatic } from "hono/middleware.ts";

const crops = await grow({
  plants: {
    Access: {
      contracts: [IAccess],
      config: {
        url: "OK",
      },
    },
    Manager: {
      contracts: [IManager],
      http: true,
    },
  },
  http(app) {
    const mgr: IManager = crops.plant("Manager");

    app.get(
      "*",
      serveStatic({ root: "./examples/simple/public" }),
    );

    app.get("/test", async (c) => {
      const result = await mgr.listItems();

      return c.json(result);
    });
  },
});
