import { caller, inject, queue } from "../../mod.ts";
import { IPublisher } from "./contract.ts";

export class Publisher implements IPublisher {
  @queue("Subscriber")
  private subscriber: any;

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

  public async changeName(): Promise<void> {
    this.subscriber.$send("changeName", "changed");
  }
}
