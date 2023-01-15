import { z } from "zod";
import caller from "https://deno.land/x/caller@0.1.4/caller.ts";
import * as path from "std/path/mod.ts";
import { Reflect } from "reflect-metadata";
import { match, P } from "ts-pattern";
import type { MsgFromWorker } from "./messages.ts";

export function config(cfgPath?: string): PropertyDecorator {
    return Reflect.metadata("config", cfgPath);
}

export function inject(serviceName: string): PropertyDecorator {
    return Reflect.metadata("inject", serviceName);
}

export const PlantDef = z.object({
    contracts: z.object({}).passthrough().array(),
    config: z.record(z.any()).optional(),
})
export type PlantDef = z.infer<typeof PlantDef>;

export const Field = z.record(PlantDef);
export type Field = z.infer<typeof Field>;

export async function grow(field: Field) {
    field = Field.parse(field);
    const servicesDir = path.dirname(caller() ?? '');
    const instances = instantiateWorkers(servicesDir, field);

    await Promise.all(Object.keys(instances).map((plantName) => {
        return serviceCommunication(plantName, instances);
    }));
}

async function serviceCommunication(
    plantName: string,
    instances: Record<string, Service>
) {
    const service = instances[plantName];

    service.worker.onmessage = (event) => {
        match<MsgFromWorker, void>(event.data)
            .with({ ready: true }, () => {
                service.worker.postMessage({
                    init: {
                        config: service.plantDef.config
                    },
                });

                // TEST CODE:
                if (plantName === "Manager") {
                    service.worker.postMessage({
                        call: {
                            method: "listItems",
                            args: [],
                            caller: "Manager",
                            receiver: "Manager",
                            callId: "1",
                        }
                    });
                }
            })
            .with({ call: P.select() }, (call) => {
                instances[call.receiver].worker
                    .postMessage({ call });

            })
            .with({ callResult: P.select() }, (result) => {
                console.log('result', result);
                instances[result.receiver].worker
                    .postMessage({ callResult: result });
            })
            .exhaustive();
    };
}

type Service = {
    worker: Worker;
    plantDef: PlantDef;
    plantName: string;
};

function instantiateWorkers(dir: string, field: Field) {
    const instances: Record<string, Service> = {};

    for (const [plantName, plantDef] of Object.entries(field)) {
        const servicePath = path.join(dir, plantName[0].toLowerCase() + plantName.slice(1));
        const relativeUrl = "./worker.ts?plantName=" + plantName + "&servicePath=" + servicePath;

        const worker = new Worker(new URL(relativeUrl, import.meta.url), {
            type: "module",
        });
        instances[plantName] = { worker, plantDef, plantName };
    }

    return instances;
}
