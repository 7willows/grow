import { z } from "../../deps.ts";

export const IInternal = z.object({
  callExternalOne: z.function()
    .returns(z.string().promise()),

  callExternalTwoViaOne: z.function()
    .returns(z.string().promise()),

  hello: z.function()
    .returns(z.string().promise()),
});
export type IInternal = z.infer<typeof IInternal>;

export const IExternalOne = z.object({
  callExternalTwo: z.function()
    .returns(z.string().promise()),

  callInternal: z.function()
    .returns(z.string().promise()),

  foo: z.function()
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
