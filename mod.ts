import { _, existsSync, log, match, P, path, z } from "./deps.ts";
import { defer, Deferred } from "./defer.ts";
import {
  CallMethod,
  Field,
  MsgFromWorker,
  PlantDef,
  Proc,
  ValidField,
} from "./types.ts";
import { getLogger } from "./logger.ts";
export { getLogger } from "./logger.ts";
export type { Logger } from "./logger.ts";
import * as channelRegistry from "./channel_registry.ts";

import { isHttpEnabled, startHttpServer } from "./http.ts";
import { Queues } from "./queues.ts";
import { GrowClient, Send, SendAck } from "./types.ts";

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

function validateField(field: Field, servicesDir: string): ValidField {
  field = Field.parse(field);

  Object.keys(field.plants).forEach((plantName) => {
    const plant = field.plants[plantName];
    plant.filePath = determineServicePath(
      servicesDir,
      plantName,
      field.plants[plantName],
    );
    plant.config = plant.config ?? {};
    plant.http = !!plant.http;
    plant.proc = plant.proc ?? plantName;
  });

  return field as ValidField;
}

function getProcsNames(field: ValidField): Set<string> {
  return Object.keys(field.plants).reduce((acc, plantName) => {
    const proc = field.plants[plantName].proc;
    acc.add(proc);
    return acc;
  }, new Set<string>());
}

export async function grow(rawField: Field) {
  const callerPath = path.dirname(caller() ?? "");
  let servicesDir = callerPath.split("file:///")[1] ?? "";

  if (!dirExists(servicesDir)) {
    // linux and windows treat paths differently.
    // to support two systems we need this workaround
    servicesDir = "/" + servicesDir;
  }

  const field = validateField(rawField, servicesDir);

  const initializedIndicator = new Map<string, Deferred<any>>();

  const procsNames = getProcsNames(field);

  for (const procName of procsNames) {
    initializedIndicator.set(procName, defer());
  }

  const procs = await createProcs(field as ValidField);

  const queues = new Queues(
    getLogger({ name: "queues:main", sessionId: "", requestId: "" }),
    function (send: Send) {
      const proc = getProc(procs, send.receiver);

      if (!proc) {
        throw new Error("proc not found: " + send.receiver);
      }

      proc.worker.postMessage({ send });
    },
  );

  procs.forEach((_proc, procName) => {
    return procCommunication(procName, queues, procs, field, () => {
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
            if (methodName === "$send") {
              do$send({
                procs,
                queues,
                plantName,
                sessionId: sessionId ?? "",
                requestId: crypto.randomUUID(),
                args,
              });
              return;
            }

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
    queue(plantName: string, sessionId: string) {
      return {
        $send(...args: any[]) {
          do$send({
            procs,
            queues,
            plantName,
            sessionId: sessionId ?? "",
            requestId: crypto.randomUUID(),
            args,
          });
        },
      };
    },
  };
}

function handleErrors(
  proc: Proc,
) {
  proc.worker.addEventListener("error", (event: any) => {
    logger.error(
      `Error in worker "${proc?.procName}" Reason: ${event.message}`,
    );
    event.stopPropagation();
    event.preventDefault();
  });
}

function stop(field: ValidField, procs: Map<string, Proc>) {
  const procsNames = getProcsNames(field);

  for (const procName of procsNames) {
    const proc = procs.get(procName)!;
    const worker = proc.worker;

    if (worker instanceof Worker) {
      worker.terminate();
    }
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

function findPlantProcName(
  procs: Map<string, Proc>,
  plantName: string,
): string | undefined {
  return Array.from(procs)
    .find(([, proc]) => proc.plants.find((p) => p.plantName === plantName))
    ?.[0];
}

function ensureValidArgs(cfg: {
  procs: Map<string, Proc>;
  args: any[];
  plantName: string;
  methodName: string;
}) {
  const contracts = findContracts(cfg.procs, cfg.plantName);
  let methodDef: any;
  const procName = findPlantProcName(cfg.procs, cfg.plantName);

  if (!cfg.procs.get(procName ?? "")) {
    throw new Error("Plant worker not found, proc: " + cfg.plantName);
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

  const proc = getProc(cfg.procs, cfg.plantName);

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

function getProc(procs: Map<string, Proc>, plantName: string): Proc {
  const proc =
    (Array.from(procs).find(([, proc]) =>
      proc.plants.find((p) => p.plantName === plantName)
    ) as Proc[])?.[1];

  if (!proc) {
    logger.error(`proc not found for plant: ${plantName}`);
    throw new Error("procNotFound");
  }

  return proc;
}

function do$send(cfg: {
  procs: Map<string, Proc>;
  queues: Queues;
  plantName: string;
  sessionId: string;
  requestId: string;
  args: any[];
}): void {
  const proc = getProc(cfg.procs, cfg.plantName);

  cfg.queues.enqueue({
    args: cfg.args,
    caller: "###MAIN",
    receiver: cfg.plantName,
    sendId: crypto.randomUUID(),
    sessionId: cfg.sessionId,
    requestId: cfg.requestId,
  });
}

function procCommunication(
  procName: string,
  queues: Queues,
  procs: Map<string, Proc>,
  field: ValidField,
  onInitComplete: () => void,
): void {
  const proc = procs.get(procName)!;

  proc.worker.addEventListener("message", (event: any) => {
    match<MsgFromWorker, void>(event.data)
      .with({ ready: true }, () => {
        const config: { [plantName: string]: any } = {};

        for (const p of proc.plants) {
          config[p.plantName] = p.plantDef.config ?? {};
        }

        proc.worker.postMessage({
          init: {
            field: getTransferableField(field),
            proc: procName,
            portNames: Array.from(proc.procsPorts).map(([name]) => name),
            config,
          },
        }, Array.from(proc.procsPorts).map(([, port]) => port));
      })
      .with({ initComplete: true }, () => {
        onInitComplete();
      })
      .with({ sendAck: P.select() }, (sendAck: SendAck) => {
        queues.onAck(sendAck);
      })
      .with({ callResult: P.select() }, (result) => {
        const deferred = calls.get(result.callId);
        if (!deferred) {
          throw new Error(`No deferred for callId ${result.callId}`);
        }

        deferred.resolve(result);
      })
      .exhaustive();
  });
}

function getTransferableField(inputField: ValidField): any {
  const field = _.cloneDeep(inputField);
  delete field.http;

  Object.keys(field.plants).forEach((plantName) => {
    delete (field as any).plants[plantName].contracts;
  });

  return field;
}

function toUnderscoreCase(text: string) {
  text = text[0].toLowerCase() + text.slice(1);
  return text.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

function determineServicePath(
  dir: string,
  plantName: string,
  plantDef: PlantDef,
) {
  if (plantDef.filePath) {
    return path.join(dir, plantDef.filePath);
  }

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

async function createProcs(field: ValidField): Promise<Map<string, Proc>> {
  const procsNames = _.uniq(
    Object
      .entries(field.plants)
      .map(([, plantDef]) => plantDef.proc),
  );

  const procs = new Map<string, Proc>();
  const channels = openChannels(procsNames);

  for (const procName of procsNames) {
    let worker!: channelRegistry.IMessagePort;

    if (procName === "main") {
      worker = channelRegistry.createChannel(procName);
      await import(`./worker.ts?proc=${procName}`);
    } else {
      worker = new Worker(
        new URL(`./worker.ts?proc=${procName}`, import.meta.url),
        { type: "module" },
      ) as any;
    }

    procs.set(procName, {
      worker,
      procName,
      plants: Object.entries(field.plants)
        .filter(([, plantDef]: any) => plantDef.proc === procName)
        .map(([plantName, plantDef]) => ({
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

    for (let j = 0; j < procsNames.length; j++) {
      if (procsNames[i] === procsNames[j]) {
        continue;
      }
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
