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
import * as resources from "./worker_resources.ts";

import type {
  Call,
  CallResult,
  MsgToWorker,
  PlantDef,
  Send,
  ValidField,
  WorkerToWorkerMsg,
} from "./types.ts";
import * as channelRegistry from "./channel_registry.ts";
import { SendAck } from "./types.ts";
import { hasExternalProcs } from "./http_comm.ts";

const url = new URL(import.meta.url);
const proc = url.searchParams.get("proc") ?? "";
resources.init(proc);
const caches: {
  [serviceName: string]: {
    [methodName: string]: Map<string, Promise<any>>;
  };
} = {};

const logger = getLogger({
  name: `WORKER[${proc}]`,
  sessionId: "",
  requestId: "",
});
const me: channelRegistry.IMessagePort = proc === "main"
  ? channelRegistry.getPort(proc)!
  : (self as any as channelRegistry.IMessagePort);

resources.ports.set("###MAIN", me);

me.addEventListener("message", (event: any) => {
  match(event.data as MsgToWorker)
    .with({ init: P.select() }, async (initMsg) => {
      resources.setSys(
        { field: initMsg.field, proc: initMsg.proc },
      );

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
      resources.setSys(
        { field: initMsg.field, proc: initMsg.proc },
      );

      await reinit({
        field: initMsg.field,
        procName: initMsg.proc,
        portNames: initMsg.portNames,
        procPorts: event.ports,
        config: initMsg.config,
      });
    })
    .with({ call: P.select() }, (call: Call) => {
      if (!resources.sys) {
        logger.error("system not initialized");
        throw new Error("service not initialized");
      }

      callPlant(call);
    })
    .with({ callResult: P.select() }, (result: CallResult) => {
      manageResult(result);
    })
    .with({ kill: true }, () => {})
    .with({ send: P.select() }, (send: Send) => {
      if (!resources.sys) {
        logger.error("system not initialized");
        throw new Error("service not initialized");
      }

      const plant = resources.plants.get(send.receiver);

      for (
        const listener of resources.findListeners(send.receiver, send.args)
      ) {
        resources.callMethod(plant, {
          ...send,
          callId: send.sendId,
          method: listener,
        });
      }

      const procName = resources.sys.field.plants[send.caller]?.proc ??
        send.caller;
      const port = resources.ports.get(procName);

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

function reinit(cfg: {
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
      resources.ports.set(plantName, cfg.procPorts[i]);
    });
  }

  resources.plants.forEach((plant: PlantDef, plantName: string) => {
    initInjectables(plantName, plant, resolver);
    initQueues(plantName, plant);
  });

  updateConfig(cfg.config);
  assignLoggers();
  setupMsgHandlers();
  return Promise.resolve();
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
    resources.plants.set(plantName, plant);

    cfg.portNames.forEach((plantName, i) => {
      listenOnPort(sys, cfg.procPorts[i]);
      resources.ports.set(plantName, cfg.procPorts[i]);
    });
  }

  resources.plants.forEach((plant: PlantDef, plantName: string) => {
    initInjectables(plantName, plant, resolver);
    initQueues(plantName, plant);
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

function httpListen(sys: resources.Sys): void {
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

    const plant = resources.plants.get(data.call.receiver);

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
      const result = await resources.callMethod(plant, data.call);
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
  resources.plants.forEach((plant: any, _plantName: string) => {
    const funcs = propsByMetadata("on", plant);

    plant[resources.LISTENERS] = [];

    for (const f of funcs) {
      const meta = Reflect.getMetadata("on", plant, f);
      plant[resources.LISTENERS].push({
        matcher: meta,
        method: f,
      });
    }
  });
}

function assignLoggers() {
  resources.plants.forEach((plant: any, plantName: string) => {
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

function listenOnPort(sys: resources.Sys, port: MessagePort) {
  port.onmessage = (event: MessageEvent) => {
    match(event.data as WorkerToWorkerMsg)
      .with({ call: P.select() }, (call: Call) => {
        callPlant(call);
      })
      .with({ callResult: P.select() }, (result: CallResult) => {
        manageResult(result);
      })
      .with({ send: P.select() }, (send: Send) => {
        const plant = resources.plants.get(send.receiver);

        for (
          const listener of resources.findListeners(send.receiver, send.args)
        ) {
          resources.callMethod(plant, {
            ...send,
            callId: send.sendId,
            method: listener,
          });
        }

        const procName = sys.field.plants[send.caller]?.proc ?? send.caller;
        const port = resources.ports.get(procName);

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
        resources.queues.onAck(sendAck);
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
  const deferred = resources.calls.get(result.callId);

  if (!deferred) {
    return;
  }

  resources.calls.delete(result.callId);

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
  const procName = resources.sys.field.plants[call.caller]?.proc ?? call.caller;
  const port = resources.ports.get(procName)!;

  if (!port) {
    throw new Error(`No port for ${call.caller}`);
  }
  const plant = resources.plants.get(call.receiver);

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

  const sys = resources.sys;

  try {
    const result = await resources.callMethod(plant, call);

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

    plant[key] = resources.buildProxy(plantName, meta);
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

function buildQueueWrapper(
  plantName: string,
  targetService: string,
) {
  const wrapper = {
    get [resources.IDENTITY]() {
      return wrapper;
    },
    $send(...args: any[]): void {
      const growParams = (wrapper as any)["###GROW"] ?? {};

      resources.sendToWorker({
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

function updateConfig(config: { [plantName: string]: any }) {
  Object.keys(config).forEach((plantName) => {
    const plant = resources.plants.get(plantName);

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
    if (!resources.plants.has(plantName)) {
      continue;
    }

    const plant = resources.plants.get(plantName);
    const initFns = propsByMetadata("init", plant);

    for (const fn of initFns) {
      await Promise.resolve(plant[fn]()).catch((err: any) => {
        logger.error("init failure [" + plantName + "]", err);
        throw new Error("initFailure");
      });
    }
  }
}
