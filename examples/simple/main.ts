import { grow } from "../../mod.ts";
import { IAccess, IManager } from "./contract.ts";

grow({
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
});
