import { z } from "zod";
import caller from "https://deno.land/x/caller@0.1.4/caller.ts";
import * as path from "std/path/mod.ts";
import { match, P } from "ts-pattern";
import { defer, Deferred } from "./defer.ts";
import { CallMethod, Field, MsgFromWorker, Service } from "./types.ts";
import { isHttpEnabled, startHttpServer } from "./http.ts";

export * from "./decorators.ts";

const calls = new Map<string, Deferred<any>>();

export async function grow(field: Field) {
  field = Field.parse(field);
  const servicesDir = path.dirname(caller() ?? "");
  const instances = instantiateWorkers(servicesDir, field);

  await Promise.all(
    Object.keys(instances).map((plantName) => {
      return serviceCommunication(plantName, instances);
    }),
  );

  if (isHttpEnabled(field)) {
    startHttpServer(field, instances, callMethod);
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
      args: cfg.args,
      callId,
    },
  });

  return deferred.promise as any;
};

function serviceCommunication(
  plantName: string,
  instances: Record<string, Service>,
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

function instantiateWorkers(dir: string, field: Field) {
  const instances: Record<string, Service> = {};

  for (const [plantName, plantDef] of Object.entries(field.plants)) {
    const servicePath = path.join(
      dir,
      plantName[0].toLowerCase() + plantName.slice(1),
    );
    const relativeUrl = "./worker.ts?plantName=" + plantName + "&servicePath=" +
      servicePath;

    const worker = new Worker(new URL(relativeUrl, import.meta.url), {
      type: "module",
    });
    instances[plantName] = { worker, plantDef, plantName };
  }

  return instances;
}
