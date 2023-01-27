import { inject, sessionId } from "../../mod.ts";
import { IAccess, IManager, Item } from "./contract.ts";

export class Manager implements IManager {
  @inject()
  private access!: IAccess;

  public async getSession(): Promise<string> {
    return this.access.getSession();
  }

  public async listItems(prefix: string): Promise<Item[]> {
    const item1 = await this.access.getItem(prefix + "test1");
    const item2 = await this.access.getItem(prefix + "test2");

    return [
      item1,
      item2,
    ];
  }

  public async throwErr(): Promise<void> {
    throw new Error("test error");
    return Promise.resolve();
  }
}
