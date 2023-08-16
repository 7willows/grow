import {
  _,
  Context,
  DependencyResolver,
  generateUUID,
  Hono,
  log,
  match,
  P,
  Reflect,
} from "./deps.ts";
import { getLogger } from "./logger.ts";

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
import { HttpComm } from "./http_comm.ts";

const url = new URL(import.meta.url);
const proc = url.searchParams.get("proc") ?? "";

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
    const port = ports.get(send.receiver);

    if (!port) {
      throw new Error("port to " + send.receiver + " not found");
    }

    port.postMessage({ send });
  },
);

me.addEventListener("message", (event: any) => {
  match(event.data as MsgToWorker)
    .with({ init: P.select() }, async (initMsg) => {
      await init({
        field: initMsg.field,
        procName: initMsg.proc,
        portNames: initMsg.portNames,
        procPorts: event.ports,
        config: initMsg.config,
      });

      me.postMessage({ initComplete: true });
    })
    .with({ call: P.select() }, (call: Call) => {
      callPlant(call);
    })
    .with({ callResult: P.select() }, (result: CallResult) => {
      manageResult(result);
    })
    .with({ send: P.select() }, (send: Send) => {
      const plant = plants.get(send.receiver);

      for (const listener of findListeners(send.receiver, send.args)) {
        callMethod(plant, {
          ...send,
          callId: send.sendId,
          method: listener,
        });
      }

      const port = ports.get(send.caller);

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
    .exhaustive();
});

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
      listenOnPort(cfg.procPorts[i]);
      ports.set(plantName, cfg.procPorts[i]);
    });

    plants.forEach((plant, plantName) => {
      initInjectables(plantName, plant, resolver);
      initQueues(plantName, plant);
    });
  }

  updateConfig(cfg.config);
  assignLoggers();
  setupMsgHandlers();

  await callInit(resolver.sort());

  httpListen(cfg.field, cfg.procName);
}

function httpListen(field: ValidField, procName: string): void {
  const procConfig = field.procs[procName];

  if (!procConfig) {
    throw new Error("field.procs[" + procName + "] not found");
  }
  const port = parseInt(new URL(procConfig.url).port, 10);
  logger.debug(procName + " listening on port " + port);

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
      const result = await callMethod(plant, data.call);
      return c.json({
        callResult: {
          type: "success",
          result,
          calLId: data.call.callId,
          receiver: data.call.caller,
        },
      });
    } catch (err) {
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

    for (const key of loggers) {
      plant[key] = getLogger({
        name: `${plantName}.init()`,
        sessionId: "",
        requestId: "",
      });
    }
  });
}

function listenOnPort(port: MessagePort) {
  port.onmessage = (event: MessageEvent) => {
    match(event.data as WorkerToWorkerMsg)
      .with({ call: P.select() }, (call: Call) => {
        callPlant(call);
      })
      .with({ callResult: P.select() }, (result: CallResult) => {
        manageResult(result);
      })
      .with({ send: P.select() }, (send: Send) => {
        const plant = plants.get(send.receiver);

        for (const listener of findListeners(send.receiver, send.args)) {
          callMethod(plant, {
            ...send,
            callId: send.sendId,
            method: listener,
          });
        }

        const port = ports.get(send.caller);

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

async function callPlant(call: Call) {
  const port = ports.get(call.caller)!;

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
    const result = await callMethod(plant, call);

    port.postMessage({
      callResult: {
        type: "success",
        result,
        callId: call.callId,
        receiver: call.caller,
      },
    });
  } catch (err) {
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

async function callMethod(plant: any, call: Call): Promise<any> {
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
    const callerProxy: any = buildProxy(call.receiver, call.caller);
    args = [callerProxy, ...args];
  }

  try {
    plantLogger.debug("started");
    const result = await wrappedPlant[call.method](...args);
    plantLogger.debug("success");
    return result;
  } catch (err) {
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

function initInjectables(plantName: string, plant: any, resolver: any) {
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

    plant[key] = buildProxy(plantName, meta);
  }

  return toInject;
}

function initQueues(plantName: string, plant: any): void {
  for (const key of Object.keys(plant)) {
    let meta = Reflect.getMetadata("queue", plant, key);

    if (!meta) {
      continue;
    }

    if (meta === "###DEDUCE") {
      meta = key[0].toUpperCase() + key.slice(1);
    }

    plant[key] = buildQueueWrapper(plantName, meta);
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

function sendToWorker(cfg: SendConfig) {
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

function buildQueueWrapper(plantName: string, targetService: string) {
  const wrapper = {
    get [IDENTITY]() {
      return wrapper;
    },
    $send(...args: any[]): void {
      const growParams = (wrapper as any)["###GROW"] ?? {};

      sendToWorker({
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

function buildProxy(plantName: string, targetService: string) {
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

        const deferred = defer();

        calls.set(callId, deferred);

        const port = ports.get(targetService);

        if (!port) {
          throw new Error(`No port for ${targetService}`);
        }

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
      };
    },
  });
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
      await plant[fn]().catch((err: any) => {
        logger.error("init failure [" + plantName + "]", err);
        throw new Error("initFailure");
      });
    }
  }
}
