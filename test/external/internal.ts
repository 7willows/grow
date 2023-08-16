import { IInternal } from "./contracts.ts";

export class Internal implements IInternal {
  public async callExternalOne(): Promise<string> {
    return "";
  }

  public async callExternalTwoViaOne(): Promise<string> {
    return "";
  }

  public async hello(): Promise<string> {
    return "world";
  }
}
