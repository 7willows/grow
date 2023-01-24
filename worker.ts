import { _, match, P, Reflect } from "./deps.ts";
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

ports.set("###MAIN", self as any);

self.onmessage = (event: MessageEvent) => {
  match(event.data as MsgToWorker)
    .with({ init: P.select() }, ({ config, toInject }) => {
      updateConfig(config);
      toInject.forEach((injectedPlantName: string, index: number) => {
        const port = event.ports[index];
        listenOnPort(port);
        ports.set(injectedPlantName, port);
      });
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

async function getPlant() {
  if (plantPromise) {
    return plantPromise;
  }

  plantPromise = import(servicePath)
    .then((mod) => new mod[plantName]())
    .catch((err) => {
      console.error(err);
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
    .with({ type: "error", error: P.select() }, (error) => {
      deferred.reject(error);
    })
    .exhaustive();
}

async function callPlant(call: Call) {
  const port = ports.get(call.caller);

  if (!port) {
    throw new Error(`No port for ${call.caller}`);
  }

  const plant = await getPlant();

  try {
    const wrappedPlant = wrapPlant(plant, {
      sessionId: call.sessionId,
      logger: console,
      requestId: call.requestId,
    });

    const result = await wrappedPlant[call.method](...call.args);

    port.postMessage({
      callResult: {
        type: "success",
        result,
        callId: call.callId,
        receiver: call.caller,
      },
    });
  } catch (err) {
    console.error("calling failed", err);
    port.postMessage({
      callResult: {
        callId: call.callId,
        receiver: call.caller,
        type: "error",
        error: (err as any)?.message ??
          `calling ${plantName}.${call.method}() failed`,
      },
    });
  }
}

function wrapPlant<T extends Object>(
  plant: T,
  cfg: { sessionId: string; logger: Console; requestId: string },
): T {
  const sessionIds = sessionIdProps(plant);
  const loggers = loggerProps(plant);
  const requestIds = requestIdProps(plant);
  const injected = injectedProps(plant);

  // TODO modify all injectables so that sessionIds and requestIds will be inherited

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

    Object.defineProperty(inj[IDENTITY], "###GROW", {
      value: {
        sessionId: cfg.sessionId,
        requestId: cfg.requestId,
      },
    });

    wrapped[key] = inj;
  }

  return wrapped;
}

function sessionIdProps(plant: any) {
  const props = [];

  for (const key of Object.keys(plant)) {
    const meta = Reflect.getMetadata("sessionId", plant, key);

    if (meta) {
      props.push(key);
    }
  }

  return props;
}

function injectedProps(plant: any) {
  const props = [];

  for (const key of Object.keys(plant)) {
    const meta = Reflect.getMetadata("inject", plant, key);

    if (meta) {
      props.push(key);
    }
  }

  return props;
}

function requestIdProps(plant: any) {
  const props = [];

  for (const key of Object.keys(plant)) {
    const meta = Reflect.getMetadata("requestId", plant, key);

    if (meta) {
      props.push(key);
    }
  }

  return props;
}

function loggerProps(plant: any) {
  const props = [];

  for (const key of Object.keys(plant)) {
    const meta = Reflect.getMetadata("logger", plant, key);

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
    const configPath = Reflect.getMetadata("config", plant, key);
    if (configPath) {
      plant[key] = _.get(config, configPath, undefined);
    }
  }
}
