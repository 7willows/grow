import { inject } from "../../mod.ts";
import { IExternalOne, IInternal } from "./contracts.ts";

export class Internal implements IInternal {
  @inject()
  private externalOne!: IExternalOne;

  public async callExternalOne(): Promise<string> {
    return await this.externalOne.foo();
  }

  public async callExternalTwoViaOne(): Promise<string> {
    return "";
  }

  public async hello(): Promise<string> {
    return "world";
  }
}
