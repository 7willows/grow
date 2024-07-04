import { _, existsSync, generateUUID, log, match, P, path, z } from "./deps.ts";
import { defer, Deferred } from "./defer.ts";
import {
  Call,
  CallMethod,
  Ctx,
  Field,
  IWorkerCommunication,
  MsgFromWorker,
  PlantDef,
  Proc,
  ProcDef,
  ValidField,
} from "./types.ts";
import { getLogger } from "./logger.ts";
export type { Logger } from "./logger.ts";
export type { Ctx } from "./types.ts";
import * as channelRegistry from "./channel_registry.ts";
import { isHttpEnabled, startHttpServer } from "./http.ts";
import { Queues } from "./queues.ts";
import { Send, SendAck } from "./types.ts";
import { ExternalWorker } from "./external_worker.ts";
import { HttpComm } from "./http_comm.ts";

export * from "./decorators.ts";

let calls = new Map<string, Deferred<any>>();

const logger = getLogger({ name: "grow", sessionId: "", requestId: "" });

export type Crops = Awaited<ReturnType<typeof grow>>;

function caller() {
  const err = new Error();
  let stack = err.stack?.split("\n")[3] ?? "";
  stack = stack.slice(stack.indexOf("at ") + 3);
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

function generateLocalUrl(
  portRange: { min: number; max: number } = { min: 37000, max: 37900 },
): string {
  for (let i = 0; i < 50; i += 1) {
    const port = _.random(portRange.min, portRange.max, false);

    if (isPortAvailable(port)) {
      return `http://0.0.0.0:${port}`;
    }
  }

  log.error("no available port could be found");
  throw new Error("No available port could be found");
}

function isPortAvailable(port: number) {
  try {
    const listener = Deno.listen({ port });
    listener.close();
    return true;
  } catch (_err) {
    return false;
  }
}

function validateField(field: Field, servicesDir: string): ValidField {
  const procs: string[] = [];

  Object.keys(field.plants).forEach((plantName) => {
    const plant = field.plants[plantName];
    plant.proc = plant.proc ?? plantName;

    const procConfig = field.procs?.[plant.proc];

    if (!procConfig?.cmd) {
      plant.filePath = determineServicePath(
        servicesDir,
        plantName,
        field.plants[plantName],
      );
    }

    plant.config = plant.config ?? {};
    plant.http = !!plant.http;

    procs.push(plant.proc ?? plantName);
  });

  field.procs = field.procs ?? {};

  for (const procName of procs) {
    const procCfg: ProcDef | undefined = field.procs[procName];
    const cwd: string = procCfg?.cwd ?? Deno.cwd();
    const url: string = procCfg?.url ? procCfg.url : generateLocalUrl();

    field.procs[procName] = {
      cwd,
      url,
      cmd: procCfg?.cmd,
      restartOnError: !!procCfg?.restartOnError,
    };
  }

  field.procs.main = {
    cwd: Deno.cwd(),
    url: generateLocalUrl(),
  };

  if (!field.communicationSecret) {
    field.communicationSecret = generateUUID();
  }

  field.initCtx = field.initCtx ?? ((_c: any, ctx: any) => ctx);

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

  const mainPort = parseInt(new URL(field.procs["main"]?.url ?? "").port, 10);
  const msgr = new HttpComm(field, mainPort);
  const procs = await createProcs(field as ValidField, msgr);
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
    return procCommunication({
      procName,
      msgr,
      queues,
      procs,
      field,
      onInitComplete: () => {
        initializedIndicator.get(procName)!.resolve(null);
      },
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
    kill: () => stop(field, procs, msgr),
    plant<T>(
      plantName: string,
      sessionId?: string,
    ) {
      return new Proxy({}, {
        get: (_, methodName: string) => {
          if (["then", "catch", "finall"].includes(methodName)) {
            return undefined;
          }

          return async (...args: any[]) => {
            const requestId = generateUUID();
            const ctx = field.initCtx(null, {
              sessionId: sessionId ?? "",
              requestId,
              data: {},
            });

            if (methodName === "$send") {
              do$send({
                procs,
                queues,
                plantName,
                procName: findPlantProcName(procs, plantName) ?? "",
                sessionId: sessionId ?? "",
                requestId,
                ctx,
                args,
              });
              return;
            }

            const r = await callMethod({
              sessionId: sessionId ?? "",
              requestId: generateUUID(),
              ctx,
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
      const requestId = generateUUID();
      const ctx = field.initCtx(null, {
        sessionId: sessionId ?? "",
        requestId,
        data: {},
      });

      return {
        $send(...args: any[]) {
          do$send({
            procs,
            queues,
            plantName,
            procName: findPlantProcName(procs, plantName) ?? "",
            sessionId: sessionId ?? "",
            requestId,
            ctx,
            args,
          });
        },
      };
    },
  };
}

function sendReInit(
  {
    proc,
    procName,
    field,
  }: {
    proc: Proc;
    procName: string;
    field: ValidField;
  },
) {
  const config: { [plantName: string]: any } = {};
  for (const p of proc.plants) {
    config[p.plantName] = p.plantDef.config ?? {};
  }

  proc.worker.postMessage(
    {
      reinit: {
        field: _.omit(getTransferableField(field), "initCtx"),
        proc: procName,
        portNames: Array.from(proc.procsPorts ?? { length: 0 })
          .map((
            [name],
          ) => name),
        config,
      },
    },
    Array.from(proc.procsPorts ?? { length: 0 }).map(([, port]) => port),
  );
}
function sendInit(
  {
    proc,
    procName,
    field,
  }: {
    proc: Proc;
    procName: string;
    field: ValidField;
  },
) {
  const config: { [plantName: string]: any } = {};
  for (const p of proc.plants) {
    config[p.plantName] = p.plantDef.config ?? {};
  }

  proc.worker.postMessage(
    {
      init: {
        field: _.omit(getTransferableField(field), "initCtx"),
        proc: procName,
        portNames: Array.from(proc.procsPorts ?? { length: 0 })
          .map((
            [name],
          ) => name),
        config,
      },
    },
    Array.from(proc.procsPorts ?? { length: 0 }).map(([, port]) => port),
  );
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

function stop(
  field: ValidField,
  procs: Map<string, Proc>,
  msgr: IWorkerCommunication,
) {
  const procsNames = getProcsNames(field);

  for (const procName of procsNames) {
    const proc = procs.get(procName)!;
    const worker = proc.worker;

    if (worker instanceof Worker || worker instanceof ExternalWorker) {
      worker.terminate();
    }
  }
  calls = new Map();
  msgr.close();
}

function findContracts(
  procs: Map<string, Proc>,
  plantName: string,
): z.ZodObject<any, any, any, any, any>[] | undefined {
  const findResult = Array.from(procs).find(([_procName, proc]) => {
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

  if (!contracts) {
    // this service has not specified contracts, everything is allowed
    return cfg.args;
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

const callMethod: CallMethod = (cfg: any) => {
  cfg.args = ensureValidArgs(cfg);

  const callId = generateUUID();
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
      ctx: cfg.ctx,
      args: cfg.args,
      callId,
    } satisfies Call,
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
  procName: string;
  plantName: string;
  sessionId: string;
  requestId: string;
  ctx: Ctx;
  args: any[];
}): void {
  cfg.queues.enqueue({
    args: cfg.args,
    caller: "###MAIN",
    receiverProc: cfg.procName,
    receiver: cfg.plantName,
    sendId: generateUUID(),
    sessionId: cfg.sessionId,
    requestId: cfg.requestId,
    ctx: cfg.ctx,
  });
}

function restart({
  procName,
  proc,
  procs,
  field,
  msgr,
  queues,
}: {
  procName: string;
  proc: Proc;
  procs: Map<string, Proc>;
  field: ValidField;
  msgr: IWorkerCommunication;
  queues: Queues;
}) {
  setTimeout(() => {
    if (
      proc.worker instanceof Worker ||
      proc.worker instanceof ExternalWorker
    ) {
      proc.worker.terminate();
    }

    const procsNames: string[] = _.uniq(
      Object
        .entries(field.plants)
        .map(([, plantDef]) => plantDef.proc),
    );

    const procsForChannels = procsNames.filter((proc) =>
      !field.procs?.[proc]?.cmd
    );

    const channels = openChannels(procsForChannels);

    createProc({ procs, field, msgr, channels, procName });

    procs.forEach((proc, procNameIterator) => {
      proc.procsPorts = channels.get(procNameIterator)!;
      procCommunication({
        procName: procNameIterator,
        msgr,
        queues,
        procs,
        field,
        onInitComplete: () => {},
      });

      if (procName !== procNameIterator) {
        sendReInit({ proc, procName: procNameIterator, field });
      }
    });
  }, 1000);
}

function procCommunication({
  procName,
  queues,
  procs,
  field,
  msgr,
  onInitComplete,
}: {
  procName: string;
  queues: Queues;
  procs: Map<string, Proc>;
  field: ValidField;
  msgr: IWorkerCommunication;
  onInitComplete: () => void;
}): void {
  const proc = procs.get(procName)!;

  if (proc.worker instanceof Worker) {
    proc.worker.onerror = (_event: any) => {
      return restart({
        procName,
        proc,
        procs,
        field,
        msgr,
        queues,
      });
    };
  }

  proc.worker.addEventListener("message", (event: any) => {
    match<MsgFromWorker, void>(event.data)
      .with({ ready: true }, () => {
        sendInit({ proc, procName, field });
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
      .with({ restartMe: true }, () => {
        return restart({
          procName,
          proc,
          procs,
          field,
          msgr,
          queues,
        });
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

async function createProcs(
  field: ValidField,
  msgr: IWorkerCommunication,
): Promise<Map<string, Proc>> {
  const procsNames: string[] = _.uniq(
    Object
      .entries(field.plants)
      .map(([, plantDef]) => plantDef.proc),
  );

  const procs = new Map<string, Proc>();

  const procsForChannels = procsNames.filter((proc) =>
    !field.procs?.[proc]?.cmd
  );
  const channels = openChannels(procsForChannels);

  for (const procName of procsNames) {
    await createProc({
      procs,
      field,
      msgr,
      channels,
      procName,
    });
  }
  return procs;
}

declare type MessagePort = any;

async function createProc({
  procs,
  field,
  msgr,
  channels,
  procName,
}: {
  procs: Map<string, Proc>;
  field: ValidField;
  msgr: IWorkerCommunication;
  channels: Map<string, Map<string, MessagePort>>;
  procName: string;
}) {
  let worker!: channelRegistry.IMessagePort;
  const procConfig = field.procs[procName] ?? {};

  if (procName === "main") {
    worker = channelRegistry.createChannel(procName);
    await import(`./worker.ts?proc=${procName}`);
  } else if (procConfig.cmd) {
    worker = new ExternalWorker(msgr, field, procName);
  } else {
    worker = new Worker(
      new URL(`./worker.ts?proc=${procName}`, import.meta.url).toString(),
      { type: "module" },
    ) as any;
  }

  procs.set(procName, {
    worker,
    procName,
    ...procConfig,
    plants: Object.entries(field.plants)
      .filter(([, plantDef]: any) => plantDef.proc === procName)
      .map(([plantName, plantDef]) => ({
        plantName,
        plantDef,
      })),
    procsPorts: channels.get(procName)!,
  });
}

declare class MessageChannel {
  port1: any;
  port2: any;
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
