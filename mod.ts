import { z } from "zod";
import caller from "https://deno.land/x/caller@0.1.4/caller.ts";
import * as path from "std/path/mod.ts";
import { Reflect } from "reflect-metadata";

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

    const services = await Promise.all(Object.entries(field).map(async ([name, plant]) => {
        const service = await growPlant(name, plant, servicesDir);
        return service;
    }));

}

export async function growPlant(
    plantName: string,
    def: PlantDef,
    dir: string,
) {
    const servicePath = path.join(dir, plantName[0].toLowerCase() + plantName.slice(1));

    const worker = new Worker(new URL("./worker.ts?plantName=" + plantName + "&servicePath=" + servicePath, import.meta.url), {
        type: "module",
    });


    worker.onmessage = (event) => {
        if (event.data.type === "ready") {
            worker.postMessage({
                type: 'config',
                config: def.config,
            });
        }
    };

    return worker;
}

// export function startWorker(
//     dir: string,
//     serviceName: string,
//     def: PlantDef
// ) {
//     const code = workerCode(dir, serviceName, def.config);
//     const blob = new Blob([code])
//     const url = URL.createObjectURL(blob);

//     const worker = new Worker(url, { type: 'module' });

//     return worker;
// }

// function workerCode(
//     dir: string,
//     serviceName: string,
//     config: Record<string, any>
// ) {
//     const workerFileName = serviceName[0].toLowerCase() + serviceName.slice(1) + ".ts";

//     return `

// `;
// }
