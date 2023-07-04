import { caller, inject } from "../../mod.ts";
import { IPublisher } from "./contract.ts";

export class Publisher implements IPublisher {
  @caller()
  public async subscribe(caller: any): Promise<string> {
    return await caller.whoami();
  }

  async whoami() {
    return "publisher";
  }
}
