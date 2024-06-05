import { defer } from "./defer.ts";
import * as resources from "./worker_resources.ts";

// export type CacheCtx = {
//   sessionId: string;
//   requestId: string;
//   args: any[];
// };

// const cachableElements = new Map<
//   { plant: string | symbol; field: string | symbol },
//   { ms: number; cacheKey: (ctx: CacheCtx) => string }
// >();

// export function cache(
//   ms: number,
//   cacheKey: (ctx: CacheCtx) => string,
// ) {
//   return function (fn: any, ctx: ClassFieldDecoratorContext) {
//     console.log("CTX", ctx);
//     if (ctx.kind === "field") {
//       return function (initialValue: any) {
//         cachableElements.set({ plant: ctx.name, field: ctx.name }, {
//           ms,
//           cacheKey,
//         });
//         return initialValue;
//       };
//     }
//   };
//   // return Reflect.metadata("cache", { ms, cacheKey });
// }

// export function config(cfgPath?: string): PropertyDecorator {
//   // return Reflect.metadata("config", cfgPath || "###DEDUCE");
// }

export function inject(serviceName?: string) {
  return function (_value: any, ctx: ClassFieldDecoratorContext) {
    if (ctx.kind !== "field" || typeof ctx.name !== "string") {
      throw new Error(
        "@inject() decorator can only be used on a class field (and not symbols)",
      );
    }

    let plantName = serviceName || ctx.name;
    plantName = plantName[0].toUpperCase() + plantName.slice(1);
    // const proxy = resources.buildProxy(

    return function (this: any, ...args: any[]) {
      console.log("THIS", this);

      return {} as any;
    };
  };
  // return Reflect.metadata("inject", serviceName || "###DEDUCE");
}

// export function sessionId(): PropertyDecorator {
//   // return Reflect.metadata("sessionId", true);
// }

// export function requestId(): PropertyDecorator {
//   // return Reflect.metadata("requestId", true);
// }

// export function logger(): PropertyDecorator {
//   // return Reflect.metadata("logger", true);
// }

// export function init(): MethodDecorator {
//   // return Reflect.metadata("init", true);
// }

// export function caller(): MethodDecorator {
//   // return Reflect.metadata("caller", true);
// }

// export function on(...what: any[]): MethodDecorator {
//   // return Reflect.metadata("on", what);
// }

// export function queue(serviceName?: string): PropertyDecorator {
//   // return Reflect.metadata("queue", serviceName || "###DEDUCE");
// }
