import { z } from "../../deps.ts";
import { inject, sessionId } from "../../mod.ts";
import * as whoAmIService from "./whoami.ts";

export const IAsker = z.object({
  ask: z.function()
    .args(z.number())
    .returns(z.object({ own: z.string(), seen: z.string() }).promise()),
});
export type IAsker = z.infer<typeof IAsker>;

export class Asker implements IAsker {
  @sessionId()
  public sid!: string;

  @inject()
  public whoAmI!: whoAmIService.IWhoAmI;

  /**
   * Zapamiętuje własną sesję, oddaje sterowanie (await), po czym pyta
   * wstrzyknięty serwis, z jaką sesją do niego dotarło wywołanie.
   * Bez wycieku `own` i `seen` muszą być identyczne.
   */
  public async ask(
    delayMs: number,
  ): Promise<{ own: string; seen: string }> {
    const own = this.sid;

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const seen = await this.whoAmI.whoAmI();

    return { own, seen };
  }
}
