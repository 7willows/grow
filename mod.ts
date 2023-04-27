import { _, existsSync, log, match, P, path, z } from "./deps.ts";
import { defer, Deferred } from "./defer.ts";
import {
  CallMethod,
  Field,
  MsgFromWorker,
  PlantDef,
  Proc,
  Service,
  ValidField
ValidField,
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

function validateField(field: Field, servicesDir: string) : field is ValidField {
  field = Field.parse(field);
  
  Object.keys(field.plants).forEach((plantName) => {
    const plant = field.plants[plantName];
    plant.filePath = determineServicePath(
      servicesDir,
      plantName,
    );
    plant.config = plant.config ?? {};
    plant.http = !!plant.config;
    plant.proc = plant.proc ?? plantName;
  });

  return true;
}

export async function grow(field: Field) {
  const callerPath = path.dirname(caller() ?? "");
  let servicesDir = callerPath.split("file:///")[1] ?? "";

  if (!dirExists(servicesDir)) {
    // linux and windows treat paths differently.
    // to support two systems we need this workaround
    servicesDir = "/" + servicesDir;
  }

  validateField(field, servicesDir);
  
  const initializedIndicator = new Map<string, Deferred<any>>();

  for (const plantName of Object.keys(field.plants)) {
    initializedIndicator.set(plantName, defer());
  }

  const procs = createProcs(field);

  procs.forEach((_proc, procName) => {
    return procCommunication(procName, procs, field, () => {
      initializedIndicator.get(procName)!.resolve(null);
    });
  });

  const promises = Array
    .from(initializedIndicator.values())
    .map((d) => d.promise);

  await Promise.all(promises);

  procs.forEach(handleErrors);

  if (isHttpEnabled(field)) {
    startHttpServer(field, procs, callMethod);
  }

  return {
    kill: () => stop(field, procs),
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
              procs,
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
  proc: Proc,
) {
  proc.worker.addEventListener("error", (event) => {
    logger.error(
      `Error in worker "${proc?.procName}" Reason: ${event.message}`,
    );
    event.stopPropagation();
    event.preventDefault();
  });
}

function stop(field: Field, procs: Map<string, Proc>) {
  for (const plantName of Object.keys(field.plants)) {
    const proc = procs.get(plantName)!;
    proc.worker.terminate();
  }
  calls = new Map();
}

function findContracts(
  procs: Map<string, Proc>,
  plantName: string,
): z.ZodObject<any, any, any, any, any>[] {
  const findResult = Array.from(procs).find(([procName, proc]) => {
    return proc.plants.find((plant) => plant.plantName === plantName);
  });

  if (!findResult) {
    throw new Error("proc not found");
  }

  const proc = findResult[1];
  const plant = proc.plants.find((plant) => plant.plantName === plantName);

  if (!plant) {
    throw new Error("plant not found");
  }

  return plant.plantDef.contracts;
}

function ensureValidArgs(cfg: {
  procs: Map<string, Proc>;
  args: any[];
  plantName: string;
  methodName: string;
}) {
  const contracts = findContracts(cfg.procs, cfg.plantName);
  let methodDef: any;

  if (!cfg.procs.get(cfg.plantName)) {
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

  const procFindResult = Array.from(cfg.procs).find(([, proc]) =>
    proc.plants.find((p) => p.plantName === cfg.plantName)
  );

  if (!procFindResult) {
    logger.error(`proc not found for plant: ${cfg.plantName}`);
    throw new Error("procNotFound");
  }

  const proc = procFindResult[1];

  proc.worker.postMessage({
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

function procCommunication(
  procName: string,
  procs: Map<string, Proc>,
  field: Field,
  onInitComplete: () => void,
): void {
  const proc = procs.get(procName)!;

  proc.worker.onmessage = (event) => {
    match<MsgFromWorker, void>(event.data)
      .with({ ready: true }, () => {
        const config: { [plantName: string]: any } = {};

        for (const p of proc.plants) {
          config[p.plantName] = p.plantDef.config ?? {};
        }

        proc.worker.postMessage({
          init: {
            field,
            proc: procName,
            portNames: Array.from(proc.procsPorts).map(([name]) => name),
            config,
          },
        }, Array.from(proc.procsPorts).map(([, port]) => port));
      })
      .with({ initComplete: true }, () => {
        onInitComplete();
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

// const channels = new Map<string[], MessageChannel>();

// function openChannels(
//   plantName: string,
//   toInject: string[],
//   instances: Record<string, Service>,
// ) {
//   const portsMap: Record<string, MessagePort> = {};

//   for (const serviceName of toInject) {
//     if (
//       channels.has([serviceName, plantName]) ||
//       channels.has([plantName, serviceName])
//     ) {
//       continue;
//     }

//     const channel = new MessageChannel();
//     channels.set([plantName, serviceName], channel);
//     portsMap[serviceName] = channel.port1;

//     if (!instances[serviceName]) {
//       logger.error(`invalid inject("${serviceName}) on ${plantName}`);
//     }

//     instances[serviceName].worker.postMessage({
//       inject: {
//         plantName,
//       },
//     }, [channel.port2]);
//   }

//   return portsMap;
// }

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

function createProcs(field: ValidField): Map<string, Proc> {
  const procsNames = _.uniq(
    Object
      .entries(field.plants)
      .map(([plantName, plantDef]) => plantDef.proc),
  );

  const procs = new Map<string, Proc>();
  const channels = openChannels(procsNames);

  for (const [procName] of procsNames) {
    procs.set(procName, {
      worker: new Worker(
        new URL(`./worker.ts?proc=${procName}`, import.meta.url),
        { type: "module" },
      ),
      procName,
      plants: Object.entries(field.plants).map(([plantName, plantDef]) => ({
        plantName,
        plantDef,
      })),
      procsPorts: channels.get(procName)!,
    });
  }

  return procs;
}
/**
 * Generate all possible combinations of ports
 */
function openChannels(
  procsNames: string[],
): Map<string, Map<string, MessagePort>> {
  const procInjections = new Map<string, Map<string, MessagePort>>();

  type Channel = {
    procNames: [string, string];
    ports: [MessagePort, MessagePort];
  };

  const channels: Channel[] = [];

  for (let i = 0; i < procsNames.length; i++) {
    for (let j = i + 1; j < procsNames.length; j++) {
      if (procsNames[i] !== procsNames[j]) {
        const channelEnds = new MessageChannel();

        channels.push({
          procNames: [procsNames[i], procsNames[j]],
          ports: [channelEnds.port1, channelEnds.port2],
        });
      }
    }
  }

  for (let i = 0; i < procsNames.length; i++) {
    const procProcs = new Map<string, MessagePort>();

    for (let j = i + 1; j < procsNames.length; j++) {
      const channel = channels.find((ch) =>
        ch.procNames.includes(procsNames[j]) &&
        ch.procNames.includes(procsNames[i])
      )!;

      const port = channel.ports.pop()!;
      procProcs.set(procsNames[j], port);
    }

    procInjections.set(procsNames[i], procProcs);
  }

  return procInjections;
}

// const services = new Map<string, Service>();

// for (const [plantName, plantDef] of Object.entries(field.plants)) {
//   const proc = plantDef.proc ?? plantName;

//   services.set(plantName, {
//     plantName,
//     plantDef,
//     contracts: plantDef.contracts,
//     worker: workersByProc.get(proc)!,
//     proc,
//   });
// }

// return services;
// }

// function createServices(plantDef: PlantDef, plantName: string, dir: string) : {
//   const servicePath = plantDef.filePath
//     ? path.join(dir, plantDef.filePath)
//     : determineServicePath(dir, plantName);

//   const queryString = `plantName=${plantName}&servicePath=${servicePath}`;

//   const worker = new Worker(
//     new URL(`./worker.ts?${queryString}`, import.meta.url),
//     { type: "module" },
//   );

//   return {
//     worker,
//     plantDef,
//     plantName,
//     contracts: plantDef.contracts,
//   };
// }
