import { z } from "../../deps.ts";
import { sessionId } from "../../mod.ts";

export const IWhoAmI = z.object({
  whoAmI: z.function()
    .args()
    .returns(z.string().promise()),
});
export type IWhoAmI = z.infer<typeof IWhoAmI>;

export class WhoAmI implements IWhoAmI {
  @sessionId()
  public sid!: string;

  public whoAmI(): Promise<string> {
    return Promise.resolve(this.sid);
  }
}
