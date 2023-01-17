import { grow } from "../../mod.ts";
import { IAccess, IManager } from "./contract.ts";

grow({
  debug: true, // w tym momencie manager jest również dostępny na GET
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
  rewrite: {
    "GET /items/:id": "/manager/get-by-id?[id]",
    "DELETE /items/:id": "/manager/delete-by-id?[id]",
  },
});
