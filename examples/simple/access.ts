import { config, sessionId } from "../../mod.ts";
import { IAccess, Item } from "./contract.ts";

export class Access implements IAccess {
  @config("url")
  private config!: string;

  @sessionId()
  private sessionId!: string;

  public async getSession(): Promise<string> {
    return this.sessionId;
  }

  public getItem(name: string): Promise<Item> {
    return Promise.resolve({
      id: Math.round(Math.random() * 100),
      name,
    });
  }
}
