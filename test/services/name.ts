import { z } from "../../deps.ts";

export const IName = z.object({
  getName: z.function()
    .args()
    .returns(z.string().promise()),

  setName: z.function()
    .args(z.string())
    .returns(z.void().promise()),
});
export type IName = z.infer<typeof IName>;

export class Name implements IName {
  private name: string;

  constructor() {
    this.name = "Tester";
  }

  public async getName(): Promise<string> {
    return this.name;
  }

  public async setName(name: string): Promise<void> {
    this.name = name;
  }
}
