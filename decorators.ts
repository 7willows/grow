import { Reflect } from "./deps.ts";

export function config(cfgPath?: string): PropertyDecorator {
  return Reflect.metadata("config", cfgPath);
}

export function inject(serviceName?: string): PropertyDecorator {
  return Reflect.metadata("inject", serviceName || "###DEDUCE");
}
