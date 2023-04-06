import { existsSync, log, match, P, path, z } from "./deps.ts";
import { defer, Deferred } from "./defer.ts";
import {
  CallMethod,
  Field,
  MsgFromWorker,
  PlantDef,
  Service,
} from "./types.ts";
import { getLogger } from "./logger.ts";
export { getLogger } from "./logger.ts";
export type { Logger } from "./logger.ts";

import { isHttpEnabled, startHttpServer } from "./http.ts";
export type { GrowClient } from "./types.ts";

export * from "./decorators.ts";

let calls = new Map<string, Deferred<any>>();

const logger = getLogger({ name: "grow", sessionId: "", requestId: "" });

export type Crops = Awaited<ReturnType<typeof grow>>;

function caller() {
  const err = new Error();
  let stack = err.stack?.split("\n")[3] ?? "";
  stack = stack.substr(stack.indexOf("at ") + 3);
  const path = stack.split(":");
  return path.slice(0, -2).join(":");
}

function dirExists(dir: string): boolean {
  try {
    Deno.statSync(dir);
    return true;
  } catch (_err) {
    return false;
  }
}

export async function grow(field: Field) {
  field = Field.parse(field);
  const callerPath = path.dirname(caller() ?? "");
  let servicesDir = callerPath.split("file:///")[1] ?? "";

  if (!dirExists(servicesDir)) {
    // linux and windows treat paths differently.
    // to support two systems we need this workaround
    servicesDir = "/" + servicesDir;
  }

  const initializedIndicator = new Map<string, Deferred<any>>();

  for (const plantName of Object.keys(field.plants)) {
    initializedIndicator.set(plantName, defer());
  }

  const instances = instantiateWorkers(servicesDir, field);

  Object.keys(instances).map((plantName) => {
    return serviceCommunication(
      plantName,
      instances,
      initializedIndicator,
    );
  });

  const promises = Array
    .from(initializedIndicator.values())
    .map((d) => d.promise);

  await Promise.all(promises);

  for (const [, service] of Object.entries(instances)) {
    handleErrors(service, servicesDir, instances);
  }

  if (isHttpEnabled(field)) {
    startHttpServer(field, instances, callMethod);
  }

  return {
    kill: () => stop(field, instances),
    plant<T>(
      plantName: string,
      sessionId?: string,
    ) {
      return new Proxy({}, {
        get: (_, methodName: string) => {
          return async (...args: any[]) => {
            const r = await callMethod({
              sessionId: sessionId ?? "",
              requestId: crypto.randomUUID(),
              plantName,
              methodName,
              args,
              instances,
            });

            if (r.type === "error") {
              const err = Object.assign(new Error(r.message), r);
              throw err;
            }

            return r.result;
          };
        },
      }) as T;
    },
  };
}

function handleErrors(
  service: Service,
  dir: string,
  instances: Record<string, Service>,
) {
  service.worker.addEventListener("error", (event) => {
    logger.error(
      `Error in worker "${service?.plantName}" Reason: ${event.message}`,
    );
    event.stopPropagation();
    event.preventDefault();
  });
}

function stop(field: Field, instances: Record<string, Service>) {
  for (const plantName of Object.keys(field.plants)) {
    const service = instances[plantName];
    service.worker.terminate();
  }
  calls = new Map();
}

function ensureValidArgs(cfg: {
  instances: Record<string, Service>;
  args: any[];
  plantName: string;
  methodName: string;
}) {
  const contracts = cfg.instances[cfg.plantName]?.contracts ?? [];
  let methodDef: any;

  if (!cfg.instances[cfg.plantName]) {
    throw new Error("Plant not found, plant: " + cfg.plantName);
  }

  outer:
  for (const contract of contracts) {
    for (const [methodName, def] of Object.entries(contract.shape)) {
      if (methodName === cfg.methodName) {
        methodDef = def;
        break outer;
      }
    }
  }

  if (!methodDef) {
    throw new Error("method not found. method:" + cfg.methodName);
  }

  const argsDef = methodDef._def.args._def.items;
  const parsed: any[] = [];

  z.any().array().parse(cfg.args);

  argsDef.forEach((argDef: any, i: number) => {
    parsed.push(argDef.parse(cfg.args[i]));
  });

  return parsed;
}

const callMethod: CallMethod = (cfg) => {
  cfg.args = ensureValidArgs(cfg);

  const callId = crypto.randomUUID();
  const deferred = defer();
  calls.set(callId, deferred);

  cfg.instances[cfg.plantName].worker.postMessage({
    call: {
      caller: "###MAIN",
      receiver: cfg.plantName,
      method: cfg.methodName,
      sessionId: cfg.sessionId,
      requestId: cfg.requestId,
      args: cfg.args,
      callId,
    },
  });

  return deferred.promise as any;
};

function serviceCommunication(
  plantName: string,
  instances: Record<string, Service>,
  initializedIndicator: Map<string, Deferred<any>>,
) {
  const service = instances[plantName];

  service.worker.onmessage = (event) => {
    match<MsgFromWorker, void>(event.data)
      .with({ ready: P.select() }, ({ toInject }) => {
        const portsMap = openChannels(service.plantName, toInject, instances);

        service.worker.postMessage({
          init: {
            config: service.plantDef.config,
            toInject: Object.keys(portsMap),
          },
        }, Object.values(portsMap));
      })
      .with({ initialized: true }, () => {
        logger.info("INITIALIZED: " + plantName);
        initializedIndicator.get(plantName)?.resolve(true);
      })
      .with({ callResult: P.select() }, (result) => {
        const deferred = calls.get(result.callId);
        if (!deferred) {
          throw new Error(`No deferred for callId ${result.callId}`);
        }

        deferred.resolve(result);
      })
      .exhaustive();
  };
}

const channels = new Map<string[], MessageChannel>();

function openChannels(
  plantName: string,
  toInject: string[],
  instances: Record<string, Service>,
) {
  const portsMap: Record<string, MessagePort> = {};

  for (const serviceName of toInject) {
    if (
      channels.has([serviceName, plantName]) ||
      channels.has([plantName, serviceName])
    ) {
      continue;
    }

    const channel = new MessageChannel();
    channels.set([plantName, serviceName], channel);
    portsMap[serviceName] = channel.port1;

    if (!instances[serviceName]) {
      logger.error(`invalid inject("${serviceName}) on ${plantName}`);
    }

    instances[serviceName].worker.postMessage({
      inject: {
        plantName,
      },
    }, [channel.port2]);
  }

  return portsMap;
}

function toUnderscoreCase(text: string) {
  text = text[0].toLowerCase() + text.slice(1);
  return text.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

function determineServicePath(dir: string, plantName: string) {
  const fileName = toUnderscoreCase(plantName);
  let p = path.join(dir, fileName + ".ts");

  if (existsSync(p)) {
    return p;
  }

  p = path.join(dir, fileName, "mod.ts");

  if (existsSync(p)) {
    return p;
  }

  throw new Error("Could not find service " + plantName);
}

function instantiateWorkers(dir: string, field: Field) {
  const instances: Record<string, Service> = {};

  for (const [plantName, plantDef] of Object.entries(field.plants)) {
    instances[plantName] = instantiateWorker(plantDef, plantName, dir);
  }

  return instances;
}

function instantiateWorker(plantDef: PlantDef, plantName: string, dir: string) {
  const servicePath = plantDef.filePath
    ? path.join(dir, plantDef.filePath)
    : determineServicePath(dir, plantName);

  const queryString = `plantName=${plantName}&servicePath=${servicePath}`;

  const worker = new Worker(
    new URL(`./worker.ts?${queryString}`, import.meta.url),
    { type: "module" },
  );

  return {
    worker,
    plantDef,
    plantName,
    contracts: plantDef.contracts,
  };
}
