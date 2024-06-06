import {
  _,
  Context,
  DependencyResolver,
  generateUUID,
  Hono,
  log,
  match,
  P,
} from "./deps.ts";
import { getLogger } from "./logger.ts";

import { Reflect } from "./reflect.ts";

import type {
  Call,
  CallResult,
  MsgToWorker,
  Send,
  ValidField,
  WorkerToWorkerMsg,
} from "./types.ts";
import { defer, Deferred } from "./defer.ts";
import * as channelRegistry from "./channel_registry.ts";
import { SendAck } from "./types.ts";
import { Queues } from "./queues.ts";
import { hasExternalProcs } from "./http_comm.ts";

type Sys = {
  field: ValidField;
  proc: string;
};

const url = new URL(import.meta.url);
const proc = url.searchParams.get("proc") ?? "";
const caches: {
  [serviceName: string]: {
    [methodName: string]: Map<string, Promise<any>>;
  };
} = {};

const IDENTITY = Symbol("proxy_target_identity");
const LISTENERS = Symbol("listeners");

const calls = new Map<string, Deferred<any>>();
const ports = new Map<string, channelRegistry.IMessagePort>();
const logger = getLogger({
  name: `WORKER[${proc}]`,
  sessionId: "",
  requestId: "",
});
const me: channelRegistry.IMessagePort = proc === "main"
  ? channelRegistry.getPort(proc)!
  : (self as any as channelRegistry.IMessagePort);
ports.set("###MAIN", me);

const plants = new Map<string, any>();
const queues = new Queues(
  getLogger({ name: "queues:" + proc, sessionId: "", requestId: "" }),
  function (send: Send): void {
    const port = ports.get(send.receiverProc);

    if (!port) {
      throw new Error("port to " + send.receiver + " not found");
    }

    port.postMessage({ send });
  },
);

let sys: Sys;

me.addEventListener("message", (event: any) => {
  match(event.data as MsgToWorker)
    .with({ init: P.select() }, async (initMsg) => {
      sys = { field: initMsg.field, proc: initMsg.proc };

      await init({
        field: initMsg.field,
        procName: initMsg.proc,
        portNames: initMsg.portNames,
        procPorts: event.ports,
        config: initMsg.config,
      });

      me.postMessage({ initComplete: true });
    })
    .with({ reinit: P.select() }, async (initMsg) => {
      sys = { field: initMsg.field, proc: initMsg.proc };

      await reinit({
        field: initMsg.field,
        procName: initMsg.proc,
        portNames: initMsg.portNames,
        procPorts: event.ports,
        config: initMsg.config,
      });
    })
    .with({ call: P.select() }, (call: Call) => {
      if (!sys) {
        logger.error("system not initialized");
        throw new Error("service not initialized");
      }

      callPlant(sys, call);
    })
    .with({ callResult: P.select() }, (result: CallResult) => {
      manageResult(result);
    })
    .with({ kill: true }, () => {})
    .with({ send: P.select() }, (send: Send) => {
      if (!sys) {
        logger.error("system not initialized");
        throw new Error("service not initialized");
      }

      const plant = plants.get(send.receiver);

      for (const listener of findListeners(send.receiver, send.args)) {
        callMethod(sys, plant, {
          ...send,
          callId: send.sendId,
          method: listener,
        });
      }

      const procName = sys.field.plants[send.caller]?.proc ?? send.caller;
      const port = ports.get(procName);

      if (!port) {
        logger.error("no port for " + send.caller);
        throw new Error("no port for " + send.caller);
      }

      port.postMessage({
        sendAck: {
          sendId: send.sendId,
          caller: send.caller,
          receiver: send.receiver,
        } satisfies SendAck,
      });
    })
    .exhaustive();
});

async function reinit(cfg: {
  field: ValidField;
  procName: string;
  portNames: string[];
  procPorts: readonly MessagePort[];
  config: {
    [plantName: string]: any;
  };
}): Promise<void> {
  const resolver = new DependencyResolver();
  const sys = { field: cfg.field, proc: cfg.procName };

  for (const [plantName] of Object.entries(cfg.field.plants)) {
    resolver.add(plantName);
  }

  for (const [plantName, plantDef] of Object.entries(cfg.field.plants)) {
    const plantProcName = plantDef.proc ?? plantName;
    if (plantProcName !== cfg.procName) {
      continue;
    }

    cfg.portNames.forEach((plantName, i) => {
      listenOnPort(sys, cfg.procPorts[i]);
      ports.set(plantName, cfg.procPorts[i]);
    });
  }

  plants.forEach((plant, plantName) => {
    initInjectables(sys, plantName, plant, resolver);
    initQueues(sys, plantName, plant);
  });

  updateConfig(cfg.config);
  assignLoggers();
  setupMsgHandlers();
}

async function init(cfg: {
  field: ValidField;
  procName: string;
  portNames: string[];
  procPorts: readonly MessagePort[];
  config: {
    [plantName: string]: any;
  };
}): Promise<void> {
  const resolver = new DependencyResolver();
  const sys = { field: cfg.field, proc: cfg.procName };

  for (const [plantName] of Object.entries(cfg.field.plants)) {
    resolver.add(plantName);
  }

  for (const [plantName, plantDef] of Object.entries(cfg.field.plants)) {
    const plantProcName = plantDef.proc ?? plantName;
    if (plantProcName !== cfg.procName) {
      continue;
    }

    const plant = await initPlant(plantName, plantDef.filePath);
    plants.set(plantName, plant);

    cfg.portNames.forEach((plantName, i) => {
      listenOnPort(sys, cfg.procPorts[i]);
      ports.set(plantName, cfg.procPorts[i]);
    });
  }

  plants.forEach((plant, plantName) => {
    initInjectables(sys, plantName, plant, resolver);
    initQueues(sys, plantName, plant);
  });

  updateConfig(cfg.config);
  assignLoggers();
  setupMsgHandlers();

  await callInit(resolver.sort()).catch((err: any) => {
    console.error("init failed", err);
    me.postMessage({ restartMe: true });
  });

  if (sys.proc !== "main" && hasExternalProcs(cfg.field)) {
    httpListen({ field: cfg.field, proc: cfg.procName });
  }
}

function httpListen(sys: Sys): void {
  const procConfig = sys.field.procs[sys.proc];

  if (!procConfig) {
    throw new Error("field.procs[" + sys.proc + "] not found");
  }
  const port = parseInt(new URL(procConfig.url).port, 10);
  logger.debug(sys.proc + " listening on port " + port);

  const app = new Hono();
  app.post("/grow/msg", async (c: Context) => {
    let data: any;

    try {
      data = await c.req.json();
    } catch (err) {
      log.error(err, "parsing request failed");
      c.status(400);
      return c.json({ error: "badRequest" });
    }
    if (!data.call) {
      return c.json({ error: "unsupported call" });
    }

    const plant = plants.get(data.call.receiver);

    if (!plant) {
      logger.error(`plant ${data.call.receiver} not found`);

      return c.json({
        callResult: {
          callId: data.call.callId,
          receiver: data.call.caller,
          type: "error",
          name: "plantNotFound",
          message: "Plant " + data.call.receiver + " not found",
        },
      });
    }

    try {
      const result = await callMethod(sys, plant, data.call);
      return c.json({
        callResult: {
          type: "success",
          result,
          calLId: data.call.callId,
          receiver: data.call.caller,
        },
      });
    } catch (err: any) {
      logger.error("Call failed", { data, err });
      return c.json({
        callResult: {
          type: "error",
          receiver: data.call.receiver,
          callId: data.call.callId,
          name: err.name,
          message: err.message,
        },
      });
    }
  });

  Deno.serve({ port }, app.fetch);
}

function setupMsgHandlers() {
  plants.forEach((plant, _plantName) => {
    const funcs = propsByMetadata("on", plant);

    plant[LISTENERS] = [];

    for (const f of funcs) {
      const meta = Reflect.getMetadata("on", plant, f);
      plant[LISTENERS].push({
        matcher: meta,
        method: f,
      });
    }
  });
}

function assignLoggers() {
  plants.forEach((plant, plantName) => {
    const loggers = propsByMetadata("logger", plant);
    if (plantName === "FlowAccess") {
      console.log("loggers", loggers);
    }

    for (const key of loggers) {
      plant[key] = getLogger({
        name: `${plantName}.init()`,
        sessionId: "",
        requestId: "",
      });
    }
  });
}

function listenOnPort(sys: Sys, port: MessagePort) {
  port.onmessage = (event: MessageEvent) => {
    match(event.data as WorkerToWorkerMsg)
      .with({ call: P.select() }, (call: Call) => {
        callPlant(sys, call);
      })
      .with({ callResult: P.select() }, (result: CallResult) => {
        manageResult(result);
      })
      .with({ send: P.select() }, (send: Send) => {
        const plant = plants.get(send.receiver);

        for (const listener of findListeners(send.receiver, send.args)) {
          callMethod(sys, plant, {
            ...send,
            callId: send.sendId,
            method: listener,
          });
        }

        const procName = sys.field.plants[send.caller]?.proc ?? send.caller;
        const port = ports.get(procName);

        if (!port) {
          throw new Error("no port for " + send.caller);
        }

        port.postMessage({
          sendAck: {
            sendId: send.sendId,
            caller: send.caller,
            receiver: send.receiver,
          } satisfies SendAck,
        });
      })
      .with({ sendAck: P.select() }, (sendAck: SendAck) => {
        queues.onAck(sendAck);
      })
      .exhaustive();
  };
}

async function initPlant(plantName: string, plantPath: string): Promise<any> {
  const mod = await import("file://" + plantPath).catch((err: any) => {
    logger.error(`import of ${plantPath} failed`, err);
    throw new Error("importFailed");
  });
  try {
    return new mod[plantName]();
  } catch (err) {
    logger.error(`instantiation of ${plantName} failed`, err);
    throw new Error("instantiationFailed");
  }
}

setTimeout(() => {
  me.postMessage({ ready: true });
});

function manageResult(result: CallResult) {
  const deferred = calls.get(result.callId);

  if (!deferred) {
    return;
  }

  calls.delete(result.callId);

  match(result)
    .with({ type: "success", result: P.select() }, (result) => {
      deferred.resolve(result);
    })
    .with({ type: "error" }, (error) => {
      const err = new Error(error.message);
      Object.assign(err, _.omit(error, "type", "callId", "receiver"));
      Object.defineProperty(err, "message", {
        value: error.message,
        enumerable: true,
      });
      deferred.reject(err);
    })
    .exhaustive();
}

async function callPlant(sys: Sys, call: Call) {
  const procName = sys.field.plants[call.caller]?.proc ?? call.caller;
  const port = ports.get(procName)!;

  if (!port) {
    throw new Error(`No port for ${call.caller}`);
  }
  const plant = plants.get(call.receiver);

  if (!plant) {
    logger.error(`plant ${call.receiver} not found`);

    return port.postMessage({
      callResult: {
        callId: call.callId,
        receiver: call.caller,
        type: "error",
        name: "plantNotFound",
        message: "Plant " + call.receiver + " not found",
      },
    });
  }

  try {
    const result = await callMethod(sys, plant, call);

    port.postMessage({
      callResult: {
        type: "success",
        result,
        callId: call.callId,
        receiver: call.caller,
      },
    });
  } catch (err) {
    if (sys.field.procs[sys.proc]?.restartOnError) {
      setTimeout(() => {
        me.postMessage({ restartMe: true });
      }, 100);
    }
    port.postMessage({
      callResult: {
        callId: call.callId,
        receiver: call.caller,
        type: "error",
        name: err.name,
        message: err.message,
        ...err,
      },
    });
  }
}

async function callMethod(sys: Sys, plant: any, call: Call): Promise<any> {
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

  const shouldInjectCaller = Reflect.getMetadata("caller", plant, call.method);

  let args = [...call.args];

  if (shouldInjectCaller) {
    const callerProxy: any = buildProxy(sys, call.receiver, call.caller);
    args = [callerProxy, ...args];
  }

  const cacheMeta = Reflect.getMetadata("cache", plant, call.method);

  let callFn = () => wrappedPlant[call.method](...args);

  if (cacheMeta) {
    const cacheKey = cacheMeta.cacheKey({
      sessionId: call.sessionId,
      requestId: call.requestId,
      args: call.args,
    });

    if (!caches[call.receiver]) {
      caches[call.receiver] = {};
    }

    if (!caches[call.receiver][call.method]) {
      caches[call.receiver][call.method] = new Map();
    }

    callFn = () => {
      if (caches[call.receiver][call.method].has(cacheKey)) {
        return caches[call.receiver][call.method].get(cacheKey)!;
      }

      const result = wrappedPlant[call.method](...args);
      caches[call.receiver][call.method].set(cacheKey, result);
      setTimeout(() => {
        caches[call.receiver][call.method].delete(cacheKey);
      }, cacheMeta.ms);
      return result;
    };
  }

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
  cfg: { sessionId: string; logger: log.Logger; requestId: string },
): T {
  const sessionIds = propsByMetadata("sessionId", plant);
  const loggers = propsByMetadata("logger", plant);
  const requestIds = propsByMetadata("requestId", plant);
  const injected = propsByMetadata("inject", plant);
  const queued = propsByMetadata("queue", plant);

  const wrapped = Object.create(plant);

  for (const key of sessionIds) {
    wrapped[key] = cfg.sessionId;
  }

  for (const key of loggers) {
    wrapped[key] = cfg.logger;
  }

  for (const key of requestIds) {
    wrapped[key] = cfg.requestId;
  }

  for (const key of injected) {
    const inj = Object.create((plant as any)[key]);

    inj[IDENTITY]["###GROW"] = {
      sessionId: cfg.sessionId,
      requestId: cfg.requestId,
    };

    wrapped[key] = inj;
  }

  for (const key of queued) {
    const q = Object.create((plant as any)[key]);

    q[IDENTITY]["###GROW"] = {
      sessionId: cfg.sessionId,
      requestId: cfg.requestId,
    };

    wrapped[key] = q;
  }

  return wrapped;
}

function propsByMetadata(metadataKey: string, plant: any) {
  const props = [];
  const keys = Object.getOwnPropertyNames(plant).concat(
    Object.getOwnPropertyNames(Object.getPrototypeOf(plant)),
  );

  for (const key of keys) {
    const meta = Reflect.getMetadata(metadataKey, plant, key);

    if (meta) {
      props.push(key);
    }
  }

  return props;
}

function initInjectables(
  sys: Sys,
  plantName: string,
  plant: any,
  resolver: any,
) {
  const toInject: string[] = [];

  for (const key of Object.keys(plant)) {
    let meta = Reflect.getMetadata("inject", plant, key);

    if (!meta) {
      continue;
    }

    if (meta === "###DEDUCE") {
      meta = key[0].toUpperCase() + key.slice(1);
    }

    resolver.setDependency(plantName, meta);
    toInject.push(meta);

    plant[key] = buildProxy(sys, plantName, meta);
  }

  return toInject;
}

function initQueues(sys: Sys, plantName: string, plant: any): void {
  for (const key of Object.keys(plant)) {
    let meta = Reflect.getMetadata("queue", plant, key);

    if (!meta) {
      continue;
    }

    if (meta === "###DEDUCE") {
      meta = key[0].toUpperCase() + key.slice(1);
    }

    plant[key] = buildQueueWrapper(sys, plantName, meta);
  }
}

type SendConfig = {
  receiver: string;
  args: any[];
  caller: string;
  sessionId: string;
  requestId: string;
  sendId: string;
};

function sendToWorker(sys: Sys, cfg: SendConfig) {
  if (plants.has(cfg.receiver)) {
    const plant = plants.get(cfg.receiver);
    for (const listener of findListeners(cfg.receiver, cfg.args)) {
      callMethod(sys, plant, {
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

function findListeners(plantName: string, args: any[]): string[] {
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

function buildQueueWrapper(sys: Sys, plantName: string, targetService: string) {
  const wrapper = {
    get [IDENTITY]() {
      return wrapper;
    },
    $send(...args: any[]): void {
      const growParams = (wrapper as any)["###GROW"] ?? {};

      sendToWorker(sys, {
        sessionId: growParams.sessionId,
        requestId: growParams.requestId,
        caller: plantName,
        receiver: targetService,
        args,
        sendId: generateUUID(),
      });
      return;
    },
  };

  return wrapper;
}

function buildProxy(
  sys: Sys,
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
          return sendToWorker(sys, {
            sessionId: growParams.sessionId,
            requestId: growParams.requestId,
            caller: plantName,
            receiver: targetService,
            args,
            sendId: callId,
          });
        }

        if (plants.has(targetService)) {
          return callMethod(sys, plants.get(targetService)!, {
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

function updateConfig(config: { [plantName: string]: any }) {
  Object.keys(config).forEach((plantName) => {
    const plant = plants.get(plantName);

    if (!plant) {
      // it's ok, we get config for all plants and this one must be not ours
      return;
    }

    for (const key of Object.keys(plant)) {
      let configPath = Reflect.getMetadata("config", plant, key);

      if (configPath === "###DEDUCE") {
        configPath = key;
      }

      if (configPath) {
        plant[key] = _.get(config[plantName], configPath, undefined);
        if (plant[key] === undefined) {
          throw new Error(plantName + ": Config not found for " + configPath);
        }
      }
    }
  });
}

async function callInit(plantsOrder: string[]) {
  for (const plantName of plantsOrder) {
    if (!plants.has(plantName)) {
      continue;
    }

    const plant = plants.get(plantName);
    const initFns = propsByMetadata("init", plant);

    for (const fn of initFns) {
      await Promise.resolve(plant[fn]()).catch((err: any) => {
        logger.error("init failure [" + plantName + "]", err);
        throw new Error("initFailure");
      });
    }
  }
}
