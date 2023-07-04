import { inject } from "../../mod.ts";
import { IPublisher, ISubscriber } from "./contract.ts";

export class Subscriber implements ISubscriber {
  @inject()
  private publisher!: any;

  public async goAndSubscribe(): Promise<string> {
    return await this.publisher.subscribe("me");
  }

  async whoami() {
    return "subscriber";
  }
}
