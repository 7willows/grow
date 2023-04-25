import { inject } from "../../mod.ts";
import { z } from "../../deps.ts";
import * as nameService from "./name.ts";

export const IHello = z.object({
  sayHello: z.function()
    .args()
    .returns(z.string().promise()),
});
export type IHello = z.infer<typeof IHello>;

export class Hello implements IHello {
  @inject()
  public name!: nameService.IName;

  public async sayHello(): Promise<string> {
    const name = await this.name.getName();

    return `Hello ${name}!`;
  }
}
