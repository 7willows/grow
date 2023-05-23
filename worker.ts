import { _, DependencyResolver, log, match, P, Reflect } from "./deps.ts";
import { getLogger } from "./logger.ts";

import type {
  Call,
  CallResult,
  MsgToWorker,
  ValidField,
  WorkerToWorkerMsg,
} from "./types.ts";
import { defer, Deferred } from "./defer.ts";
import * as channelRegistry from "./channel_registry.ts";

const url = new URL(import.meta.url);
const proc = url.searchParams.get("proc") ?? "";

const IDENTITY = Symbol("proxy_target_identity");

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
    .with({ call: P.select() }, (call) => {
      callPlant(call);
    })
    .with({ callResult: P.select() }, (result) => {
      manageResult(result);
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

    updateConfig(cfg.config);
    assignLoggers();

    cfg.portNames.forEach((plantName, i) => {
      listenOnPort(cfg.procPorts[i]);
      ports.set(plantName, cfg.procPorts[i]);
    });

    plants.forEach((plant, plantName) => {
      initInjectables(plantName, plant, resolver);
    });
  }

  await callInit(resolver.sort());
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
      .with({ call: P.select() }, (call) => {
        callPlant(call);
      })
      .with({ callResult: P.select() }, (result) => {
        manageResult(result);
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

  try {
    plantLogger.debug("started");
    const result = await wrappedPlant[call.method](...call.args);
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

function buildProxy(plantName: string, targetService: string) {
  return new Proxy({}, {
    get: (target, prop) => {
      if (prop === IDENTITY) {
        return target;
      }

      return (...args: any[]) => {
        const callId = crypto.randomUUID();
        const growParams = (target as any)["###GROW"] ?? {};

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
