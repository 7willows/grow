import { z } from "zod";
import caller from "https://deno.land/x/caller@0.1.4/caller.ts";
import * as path from "std/path/mod.ts";
import { Reflect } from "reflect-metadata";
import { match, P } from "ts-pattern";
import type { CallResult, MsgFromWorker } from "./messages.ts";
import { Context, Hono } from "hono";
import { serve } from "std/http/server.ts";
import { defer, Deferred } from "./defer.ts";

export function config(cfgPath?: string): PropertyDecorator {
  return Reflect.metadata("config", cfgPath);
}

export function inject(serviceName?: string): PropertyDecorator {
  return Reflect.metadata("inject", serviceName || "###DEDUCE");
}

export const PlantDef = z.object({
  contracts: z.array(z.any()),
  config: z.record(z.any()).optional(),
  http: z.boolean().optional(),
});
export type PlantDef = z.infer<typeof PlantDef>;

export const Field = z.object({
  debug: z.boolean().optional(),
  plants: z.record(PlantDef),
  rewrite: z.record(z.string()).optional(),
});
export type Field = z.infer<typeof Field>;

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
    startHttpServer(field, instances);
  }
}

function isHttpEnabled(field: Field) {
  return Object.values(field.plants).some((plant) => plant.http);
}

function startHttpServer(
  field: Field,
  instances: Record<string, Service>,
) {
  const app = new Hono();

  defineStandardRoutes(app, field, instances);
  defineRewrites(app, field);

  serve(app.fetch);
}

function defineRewrites(app: Hono, field: Field) {
}

function defineStandardRoutes(
  app: Hono,
  field: Field,
  instances: Record<string, Service>,
) {
  for (const [plantName, plantDef] of Object.entries(field.plants)) {
    const plantNameDashCase = toDashCase(plantName);

    for (const contract of plantDef.contracts) {
      for (const [methodName, methodDef] of Object.entries(contract.shape)) {
        const methodDashCase = toDashCase(methodName);

        const url = `/${plantNameDashCase}/${methodDashCase}`;

        app.post(
          url,
          handleRequest({
            plantName,
            methodName,
            methodDef: methodDef as z.ZodFunction<any, any>,
            instances,
          }),
        );
      }
    }
  }
}

/**
 * Structure of request:
 * POST /plant-name/method-name
 * Content-Type: application/json
 *
 * [
 *   arg1,
 *   arg2,
 * ]
 */
function handleRequest(cfg: {
  plantName: string;
  methodName: string;
  methodDef: z.ZodFunction<any, any>;
  instances: Record<string, Service>;
}) {
  return async (c: Context<any, any, any>) => {
    const args = await c.req.json();
    const argsDef = cfg.methodDef._def.args._def.items;
    const parsed: any[] = [];

    for (const argDef of argsDef) {
      parsed.push(argDef.parse(args));
    }

    const result = await callMethod({
      plantName: cfg.plantName,
      methodName: cfg.methodName,
      args: parsed,
      instances: cfg.instances,
    });

    if ("error" in result) {
      return c.json(result.error, 500);
    }

    return c.json(result.result);
  };
}

function callMethod(cfg: {
  plantName: string;
  methodName: string;
  args: any[];
  instances: Record<string, Service>;
}): Promise<CallResult> {
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
}

function toDashCase(text: string) {
  return text.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
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

type Service = {
  worker: Worker;
  plantDef: PlantDef;
  plantName: string;
};

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
