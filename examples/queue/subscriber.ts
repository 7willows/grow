import { inject, on, queue } from "../../mod.ts";
import { IPublisher, ISubscriber } from "./contract.ts";

export class Subscriber implements ISubscriber {
  @inject()
  private publisher!: any;

  private data = {
    fooValue: "",
    name: "subscriber",
  };

  public async goAndSubscribe(): Promise<string> {
    return await this.publisher.subscribe("me");
  }

  @on("foo")
  private onFoo(_: any, fooValue: string) {
    this.data.fooValue = fooValue;
  }

  public async whatIsFoo(): Promise<string> {
    return this.data.fooValue;
  }

  async whoami() {
    console.log("get", this.data);
    return this.data.name;
  }

  @on("changeName")
  public change(_: any, name: string): void {
    console.log("change");
    this.data.name = name;
  }
}
