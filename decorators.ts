import { Reflect } from "./deps.ts";

export function config(cfgPath?: string): PropertyDecorator {
  return Reflect.metadata("config", cfgPath || "###DEDUCE");
}

export function inject(serviceName?: string): PropertyDecorator {
  return Reflect.metadata("inject", serviceName || "###DEDUCE");
}

export function sessionId(): PropertyDecorator {
  return Reflect.metadata("sessionId", true);
}

export function requestId(): PropertyDecorator {
  return Reflect.metadata("requestId", true);
}

export function logger(): PropertyDecorator {
  return Reflect.metadata("logger", true);
}

export function init(): MethodDecorator {
  return Reflect.metadata("init", true);
}

export function caller(): MethodDecorator {
  return Reflect.metadata("caller", true);
}

export function on(): MethodDecorator {
  return Reflect.metadata("on", true);
}

export function queuedQuery(): MethodDecorator {
  return Reflect.metadata("queued", true);
}
