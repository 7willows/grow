import { caller, existsSync, match, P, path } from "./deps.ts";
import { defer, Deferred } from "./defer.ts";
import { CallMethod, Field, MsgFromWorker, Service } from "./types.ts";
import { isHttpEnabled, startHttpServer } from "./http.ts";
export type { GrowClient } from "./types.ts";

export * from "./decorators.ts";

const calls = new Map<string, Deferred<any>>();

export type Crops = Awaited<ReturnType<typeof grow>>;

export async function grow(field: Field) {
  field = Field.parse(field);
  const servicesDir = path.dirname(caller() ?? "").split("file://")[1] ?? "";
  const initializedIndicator = new Map<string, Deferred<any>>();

  for (const plantName of Object.keys(field.plants)) {
    initializedIndicator.set(plantName, defer());
  }

  const instances = instantiateWorkers(servicesDir, field);

  await Promise.all(
    Object.keys(instances).map((plantName) => {
      return serviceCommunication(
        plantName,
        instances,
        initializedIndicator,
      );
    }),
  );

  await Promise.all(
    Array.from(initializedIndicator.values())
      .map((v) => v.promise),
  );

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

            if ("error" in r) {
              throw new Error(r.error);
            }

            return r.result;
          };
        },
      }) as T;
    },
  };
}

function stop(field: Field, instances: Record<string, Service>) {
  for (const plantName of Object.keys(field.plants)) {
    const service = instances[plantName];
    service.worker.terminate();
  }
}

const callMethod: CallMethod = (cfg) => {
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

const channels = new Map<string, MessageChannel>();

function openChannels(
  plantName: string,
  toInject: string[],
  instances: Record<string, Service>,
) {
  const portsMap: Record<string, MessagePort> = {};

  for (const serviceName of toInject) {
    if (
      channels.has(serviceName + "-" + plantName) ||
      channels.has(plantName + "-" + serviceName)
    ) {
      continue;
    }

    const channel = new MessageChannel();
    channels.set(plantName + "-" + serviceName, channel);
    portsMap[serviceName] = channel.port1;
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
    const servicePath = plantDef.filePath
      ? path.join(dir, plantDef.filePath)
      : determineServicePath(dir, plantName);

    const queryString = `plantName=${plantName}&servicePath=${servicePath}`;

    const worker = new Worker(
      new URL(`./worker.ts?${queryString}`, import.meta.url),
      {
        type: "module",
      },
    );
    instances[plantName] = { worker, plantDef, plantName };
  }

  return instances;
}
