import { generateUUID } from "./deps.ts";
import { getLogger, Logger } from "./logger.ts";
import * as channelRegistry from "./channel_registry.ts";
import type { Call, Send, ValidField } from "./types.ts";
import { defer, Deferred } from "./defer.ts";
import { Queues } from "./queues.ts";

export const IDENTITY = Symbol("proxy_target_identity");
export const LISTENERS = Symbol("listeners");

export type Sys = {
  field: ValidField;
  proc: string;
};

export const calls = new Map<string, Deferred<any>>();
export const ports = new Map<string, channelRegistry.IMessagePort>();

export const plants = new Map<string, any>();

export let queues: Queues;

let logger: Logger;

export function init(proc: string) {
  queues = new Queues(
    getLogger({ name: "queues:" + proc, sessionId: "", requestId: "" }),
    function (send: Send): void {
      const port = ports.get(send.receiverProc);

      if (!port) {
        throw new Error("port to " + send.receiver + " not found");
      }

      port.postMessage({ send });
    },
  );

  logger = getLogger({
    name: `WORKER[${proc}]`,
    sessionId: "",
    requestId: "",
  });
}

export let sys: Sys;

export function setSys(s: Sys): void {
  sys = s;
}

async function callOverHttp(sys: Sys, call: {
  method: string;
  sessionId: string;
  requestId: string;
  caller: string;
  receiver: string;
  args: any[];
  callId: string;
}): Promise<any> {
  const procName = sys.field.plants[call.receiver]?.proc;
  const url = sys.field.procs[procName]?.url;

  if (!url) {
    throw new Error(`No connection to ${call.receiver}`);
  }

  const result = await fetch(url + "/grow/msg", {
    method: "POST",
    headers: {
      "communication-secret": sys.field.communicationSecret,
      "Content-Type": "application/json",
      "Connection": "keep-alive",
    },
    body: JSON.stringify({ call }),
  }).catch((err: Error) => {
    logger.error(`Calling ${call.receiver}.${call.method}() failed`, err);
    throw new Error("http error");
  });

  const text = await result.text().catch((err: Error) => {
    logger.error(
      `reading response from ${call.receiver}.${call.method}() as text failed`,
      err,
    );
    throw new Error("parse error");
  });

  if (result.status !== 200) {
    logger.error(`calling ${call.receiver}.${call.method}() failed`, result);
    throw new Error("invalid response from server");
  }

  let jsonResponse: any;
  try {
    jsonResponse = JSON.parse(text);
  } catch (err) {
    logger.error(text.slice(0, 1e4));
    logger.error(
      `parsing response from ${call.receiver}.${call.method}() as json failed`,
      err,
    );
    throw new Error("parse error");
  }

  if (!jsonResponse.callResult) {
    logger.error(
      `invalid response from ${call.receiver}.${call.method}()`,
      result,
    );
    throw new Error("invalid response from server");
  }

  return jsonResponse.callResult.result;
}

type SendConfig = {
  receiver: string;
  args: any[];
  caller: string;
  sessionId: string;
  requestId: string;
  sendId: string;
};

export function findListeners(plantName: string, args: any[]): string[] {
  const plant = plants.get(plantName);

  if (!plant) {
    logger.error("Plant " + plantName + " not found");
    throw new Error("plant not found");
  }

  const funcs: string[] = [];

  for (const l of plant[LISTENERS]) {
    if (matchListener(args, l.matcher)) {
      funcs.push(l.method);
    }
  }

  return funcs;
}

function matchListener(args: any[], matcher: any[]): boolean {
  return matcher.every((m, index) => m === args[index]);
}

export function sendToWorker(cfg: SendConfig) {
  if (plants.has(cfg.receiver)) {
    const plant = plants.get(cfg.receiver);
    for (const listener of findListeners(cfg.receiver, cfg.args)) {
      callMethod(plant, {
        ...cfg,
        callId: cfg.sendId,
        method: listener,
      });
    }
  } else {
    queues.enqueue({
      args: cfg.args,
      caller: cfg.caller,
      receiverProc: sys.field.plants[cfg.receiver]?.proc ?? cfg.receiver,
      receiver: cfg.receiver,
      sendId: cfg.sendId,
      sessionId: cfg.sessionId,
      requestId: cfg.requestId,
    });
  }
}

export function buildProxy(
  plantName: string,
  targetService: string,
) {
  return new Proxy({}, {
    get: (target, prop) => {
      if (prop === IDENTITY) {
        return target;
      }

      return (...args: any[]) => {
        const callId = generateUUID();
        const growParams = (target as any)["###GROW"] ?? {};

        if (prop === "$send") {
          return sendToWorker({
            sessionId: growParams.sessionId,
            requestId: growParams.requestId,
            caller: plantName,
            receiver: targetService,
            args,
            sendId: callId,
          });
        }

        if (plants.has(targetService)) {
          return callMethod(plants.get(targetService)!, {
            sessionId: growParams.sessionId,
            requestId: growParams.requestId,
            caller: plantName,
            receiver: targetService,
            method: prop as any,
            args,
            callId,
          });
        }

        const procName = sys.field.plants[targetService]?.proc ?? targetService;
        const port = ports.get(procName);

        if (port) {
          const deferred = defer();
          calls.set(callId, deferred);

          port.postMessage({
            call: {
              method: prop,
              args,
              caller: plantName,
              receiver: targetService,
              callId,
              sessionId: growParams.sessionId,
              requestId: growParams.requestId,
            } as Call,
          });

          return deferred.promise;
        }

        return callOverHttp(sys, {
          method: prop as string,
          sessionId: growParams.sessionId,
          requestId: growParams.requestId,
          caller: plantName,
          receiver: targetService,
          args,
          callId,
        });
      };
    },
  });
}

export async function callMethod(
  plant: any,
  call: Call,
): Promise<any> {
  const plantLogger = getLogger({
    name: `${call.receiver}.${call.method}()`,
    sessionId: call.sessionId,
    requestId: call.requestId,
  });

  const wrappedPlant = wrapPlant(plant, {
    sessionId: call.sessionId,
    logger: plantLogger,
    requestId: call.requestId,
  });

  // const shouldInjectCaller = Reflect.getMetadata("caller", plant, call.method);

  const args = [...call.args];

  // if (shouldInjectCaller) {
  //   const callerProxy: any = buildProxy(sys, call.receiver, call.caller);
  //   args = [callerProxy, ...args];
  // }

  // const cacheMeta = Reflect.getMetadata("cache", plant, call.method);

  const callFn = () => wrappedPlant[call.method](...args);

  // if (cacheMeta) {
  //   const cacheKey = cacheMeta.cacheKey({
  //     sessionId: call.sessionId,
  //     requestId: call.requestId,
  //     args: call.args,
  //   });

  //   if (!caches[call.receiver]) {
  //     caches[call.receiver] = {};
  //   }

  //   if (!caches[call.receiver][call.method]) {
  //     caches[call.receiver][call.method] = new Map();
  //   }

  //   callFn = () => {
  //     // if (caches[call.receiver][call.method].has(cacheKey)) {
  //     //   return caches[call.receiver][call.method].get(cacheKey)!;
  //     // }

  //     const result = wrappedPlant[call.method](...args);
  //     // caches[call.receiver][call.method].set(cacheKey, result);
  //     // setTimeout(() => {
  //     //   caches[call.receiver][call.method].delete(cacheKey);
  //     // }, cacheMeta.ms);
  //     return result;
  //   };
  // }

  try {
    plantLogger.debug("started");
    const result = await callFn();
    plantLogger.debug("success");
    return result;
  } catch (err) {
    plantLogger.error("call", { service: call.receiver, method: call.method });
    plantLogger.error("failure", err);
    throw err;
  }
}

function wrapPlant<T extends Record<string, unknown>>(
  plant: T,
  _cfg: { sessionId: string; logger: Logger; requestId: string },
): T {
  return plant;
  // const sessionIds = propsByMetadata("sessionId", plant);
  // const loggers = propsByMetadata("logger", plant);
  // const requestIds = propsByMetadata("requestId", plant);
  // const injected = propsByMetadata("inject", plant);
  // const queued = propsByMetadata("queue", plant);

  // const wrapped = Object.create(plant);

  // for (const key of sessionIds) {
  //   wrapped[key] = cfg.sessionId;
  // }

  // for (const key of loggers) {
  //   wrapped[key] = cfg.logger;
  // }

  // for (const key of requestIds) {
  //   wrapped[key] = cfg.requestId;
  // }

  // for (const key of injected) {
  //   const inj = Object.create((plant as any)[key]);

  //   inj[IDENTITY]["###GROW"] = {
  //     sessionId: cfg.sessionId,
  //     requestId: cfg.requestId,
  //   };

  //   wrapped[key] = inj;
  // }

  // for (const key of queued) {
  //   const q = Object.create((plant as any)[key]);

  //   q[IDENTITY]["###GROW"] = {
  //     sessionId: cfg.sessionId,
  //     requestId: cfg.requestId,
  //   };

  //   wrapped[key] = q;
  // }

  // return wrapped;
}
