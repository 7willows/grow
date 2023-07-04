import { caller, inject } from "../../mod.ts";
import { IPublisher } from "./contract.ts";

export class Publisher implements IPublisher {
  private data: any = {
    subscriber: undefined,
  };

  @caller()
  public async subscribe(caller: any): Promise<string> {
    this.data.subscriber = caller;
    return await caller.whoami();
  }

  public async publish(): Promise<void> {
    this.data.subscriber.$send("foo", "bar");
  }
}
