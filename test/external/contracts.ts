import { z } from "../../deps.ts";

export const IInternal = z.object({});
export type IInternal = z.infer<typeof IInternal>;

export const IExternalOne = z.object({
  callExternalTwo: z.function()
    .returns(z.string().promise()),
});
export type IExternalOne = z.infer<typeof IExternalOne>;

export const IExternalTwo = z.object({
  returnOk: z.function()
    .returns(z.string().promise()),

  crash: z.function()
    .returns(z.void().promise()),
});
export type IExternalTwo = z.infer<typeof IExternalTwo>;
