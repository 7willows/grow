import { Reflect } from "./reflect.ts";

export type CacheCtx = {
  sessionId: string;
  requestId: string;
  args: any[];
};

export function cache(
  ms: number,
  cacheKey: (ctx: CacheCtx) => string,
) {
  return Reflect.metadata("cache", { ms, cacheKey });
}

export function ctx() {
  return Reflect.metadata("ctx", true);
}

export function config(cfgPath?: string) {
  return Reflect.metadata("config", cfgPath || "###DEDUCE");
}

export function inject(serviceName?: string) {
  return Reflect.metadata("inject", serviceName || "###DEDUCE");
}

export function configurableInject(serviceName?: string) {
  return Reflect.metadata("configurableInject", serviceName || "###DEDUCE");
}

export function sessionId() {
  return Reflect.metadata("sessionId", true);
}

<<<<<<< Updated upstream
export function requestId() {
=======
export function caller(): PropertyDecorator {
  return Reflect.metadata("caller", true);
}

export function requestId(): PropertyDecorator {
>>>>>>> Stashed changes
  return Reflect.metadata("requestId", true);
}

export function logger() {
  return Reflect.metadata("logger", true);
}

export function init() {
  return Reflect.metadata("init", true);
}

export function caller() {
  return Reflect.metadata("caller", true);
}

export function on(...what: any[]) {
  return Reflect.metadata("on", what);
}

export function queue(serviceName?: string) {
  return Reflect.metadata("queue", serviceName || "###DEDUCE");
}
