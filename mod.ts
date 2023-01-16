import { z } from "zod";
import caller from "https://deno.land/x/caller@0.1.4/caller.ts";
import * as path from "std/path/mod.ts";
import { Reflect } from "reflect-metadata";
import { match, P } from "ts-pattern";
import type { MsgFromWorker } from "./messages.ts";

export function config(cfgPath?: string): PropertyDecorator {
  return Reflect.metadata("config", cfgPath);
}

export function inject(serviceName?: string): PropertyDecorator {
  return Reflect.metadata("inject", serviceName || "###DEDUCE");
}

export const PlantDef = z.object({
  contracts: z.object({}).passthrough().array(),
  config: z.record(z.any()).optional(),
});
export type PlantDef = z.infer<typeof PlantDef>;

export const Field = z.record(PlantDef);
export type Field = z.infer<typeof Field>;

export async function grow(field: Field) {
  field = Field.parse(field);
  const servicesDir = path.dirname(caller() ?? "");
  const instances = instantiateWorkers(servicesDir, field);

  await Promise.all(
    Object.keys(instances).map((plantName) => {
      return serviceCommunication(plantName, instances);
    }),
  );
}

async function serviceCommunication(
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

        // TEST CODE:
        if (plantName === "Manager") {
          service.worker.postMessage({
            call: {
              method: "listItems",
              args: [],
              caller: "###MAIN",
              receiver: "Manager",
              callId: "1",
            },
          });
        }
      })
      .with({ call: P.select() }, (call) => {
        instances[call.receiver].worker
          .postMessage({ call });
      })
      .with({ callResult: P.select() }, (result) => {
        console.log("result", result);
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

type Service = {
  worker: Worker;
  plantDef: PlantDef;
  plantName: string;
};

function instantiateWorkers(dir: string, field: Field) {
  const instances: Record<string, Service> = {};

  for (const [plantName, plantDef] of Object.entries(field)) {
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
