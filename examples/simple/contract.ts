import { z } from "zod";

export const Item = z.object({
    id: z.number(),
    name: z.string(),
});
export type Item = z.infer<typeof Item>;

export const IManager = z.object({
    listItems: z.function().returns(Item.array().promise()),
});
export type IManager = z.infer<typeof IManager>;

export const IAccess = z.object({
    getItem: z.function().args(z.string()).returns(Item.promise()),
});
export type IAccess = z.infer<typeof IAccess>;
