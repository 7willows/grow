import { _, log, match, P, Reflect } from "./deps.ts";
import { getLogger } from "./logger.ts";

import type {
  Call,
  CallResult,
  MsgToWorker,
  WorkerToWorkerMsg,
} from "./types.ts";
import { defer, Deferred } from "./defer.ts";

const url = new URL(import.meta.url);
const plantName = url.searchParams.get("plantName") ?? "";
const servicePath = url.searchParams.get("servicePath") ?? "";

const IDENTITY = Symbol("proxy_target_identity");
if (!plantName || !servicePath) {
  throw new Error("Missing plantName or servicePath");
}

let plantPromise: Promise<any>;
const calls = new Map<string, Deferred<any>>();
const ports = new Map<string, MessagePort>();
const logger = getLogger({
  name: `WORKER[${plantName}]`,
  sessionId: "",
  requestId: "",
});

ports.set("###MAIN", self as any);

self.onmessage = (event: MessageEvent) => {
  match(event.data as MsgToWorker)
    .with({ init: P.select() }, async ({ config, toInject }) => {
      await updateConfig(config);
      assignLoggers();
      toInject.forEach((injectedPlantName: string, index: number) => {
        const port = event.ports[index];
        listenOnPort(port);
        ports.set(injectedPlantName, port);
      });
      await callInit();
      self.postMessage({ initialized: true });
    })
    .with({ configUpdate: P.select() }, (config) => {
      updateConfig(config);
    })
    .with({ call: P.select() }, (call) => {
      callPlant(call);
    })
    .with({ callResult: P.select() }, (result) => {
      manageResult(result);
    })
    .with({ inject: P.select() }, ({ plantName }) => {
      const port = event.ports[0];
      listenOnPort(port);
      ports.set(plantName, port);
    })
    .exhaustive();
};

async function assignLoggers() {
  const plant = await getPlant();
  const loggers = propsByMetadata("logger", plant);

  for (const key of loggers) {
    plant[key] = getLogger({
      name: `${plantName}.init()`,
      sessionId: "",
      requestId: "",
    });
  }
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

function getPlant() {
  if (plantPromise) {
    return plantPromise;
  }

  plantPromise = import("file://" + servicePath)
    .then((mod) => new mod[plantName]())
    .catch((err) => {
      logger.error(`importing service ${servicePath} failed`, err);
      throw err;
    });

  return plantPromise;
}

async function preInit() {
  const plant = await getPlant();
  const toInject = initInjectables(plant);
  self.postMessage({ ready: { toInject } });
}

preInit();

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
  const port = ports.get(call.caller);

  if (!port) {
    throw new Error(`No port for ${call.caller}`);
  }

  const plant = await getPlant();
  const logger = getLogger({
    name: `${plantName}.${call.method}()`,
    sessionId: call.sessionId,
    requestId: call.requestId,
  });

  const wrappedPlant = wrapPlant(plant, {
    sessionId: call.sessionId,
    logger,
    requestId: call.requestId,
  });

  try {
    logger.debug("started");
    const result = await wrappedPlant[call.method](...call.args);
    logger.debug("success");

    port.postMessage({
      callResult: {
        type: "success",
        result,
        callId: call.callId,
        receiver: call.caller,
      },
    });
  } catch (err) {
    logger.error("failure", err);
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

function initInjectables(plant: any) {
  const toInject: string[] = [];

  for (const key of Object.keys(plant)) {
    let meta = Reflect.getMetadata("inject", plant, key);

    if (!meta) {
      continue;
    }

    if (meta === "###DEDUCE") {
      meta = key[0].toUpperCase() + key.slice(1);
    }

    toInject.push(meta);

    plant[key] = buildProxy(meta);
  }

  return toInject;
}

function buildProxy(targetService: string) {
  return new Proxy({}, {
    get: (target, prop) => {
      if (prop === IDENTITY) {
        return target;
      }

      return (...args: any[]) => {
        const callId = crypto.randomUUID();
        const deferred = defer();

        calls.set(callId, deferred);

        const port = ports.get(targetService);

        if (!port) {
          throw new Error(`No port for ${targetService}`);
        }

        const growParams = (target as any)["###GROW"] ?? {};

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

async function updateConfig(config: any) {
  const plant = await getPlant();

  for (const key of Object.keys(plant)) {
    let configPath = Reflect.getMetadata("config", plant, key);

    if (configPath === "###DEDUCE") {
      configPath = key[0].toUpperCase() + key.slice(1);
    }

    if (configPath) {
      plant[key] = _.get(config, configPath, undefined);
      if (plant[key] === undefined) {
        throw new Error(plantName + ": Config not found for " + configPath);
      }
    }
  }
}

async function callInit() {
  const plant = await getPlant();
  const initFns = propsByMetadata("init", plant);

  for (const fn of initFns) {
    await plant[fn]();
  }
}
