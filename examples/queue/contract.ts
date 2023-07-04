import { z } from "../../deps.ts";

export const IPublisher = z.object({
  subscribe: z.function()
    .returns(z.string().promise()),

  publish: z.function(),
});
export type IPublisher = z.infer<typeof IPublisher>;

export const ISubscriber = z.object({
  goAndSubscribe: z.function()
    .args()
    .returns(z.string().promise()),

  whoami: z.function()
    .returns(z.string().promise()),

  whatIsFoo: z.function()
    .returns(z.string().promise()),
});
export type ISubscriber = z.infer<typeof ISubscriber>;
