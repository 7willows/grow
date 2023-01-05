import { z } from "zod";
import caller from "https://deno.land/x/caller@0.1.4/caller.ts";
import * as path from "std/path/mod.ts";

export function config(cfgPath?: string) {
    return function (target:any, prop:string) {
        Object.defineProperty(target, prop, {
            value:{
                ___growDecorator: true,
                type: 'config',
                cfgPath,
            },
            enumerable: true
        });
    }
}

export function inject(serviceName: string) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        // console.log('abc', {serviceName});
    }
}

export const PlantDef =z.object({
    contract: z.object({}).passthrough().array(),
    config: z.record(z.any()).optional(),
}) 
export type PlantDef = z.infer<typeof PlantDef>;

export const Field = z.record(PlantDef);
export type Field = z.infer<typeof Field>;

export function grow(field: Field) {
    field = Field.parse(field);
    const servicesDir = path.dirname(caller() ?? ''); 

    for (const [name, def] of Object.entries(field)) {
        const worker = startWorker(servicesDir, name, def);
    }
}

export function startWorker(
    dir: string,
    serviceName: string,
    def: PlantDef
) {
    const code = workerCode(dir, serviceName, def.config);
    const blob = new Blob([code])
    const url = URL.createObjectURL(blob);

    const worker = new Worker(url, { type: 'module' });

    return worker;
}

function workerCode(
    dir:string,
    serviceName:string,
    config: Record<string, any>
) {
    const workerFileName = serviceName[0].toLowerCase() + serviceName.slice(1) + ".ts";
    
    return `
import { ${serviceName} } from "${dir}/${workerFileName}";
import * as _ from 'lodash';

const service = new ${serviceName}();

for (const [prop, value] of Object.entries(${serviceName}.prototype)) {
    if (value?.___growDecorator) {
        if (value.type === 'config') {
            service[prop] = ${JSON.stringify(config)};
            if (value.cfgPath) {
                service[prop] = _.get(service[prop], value.cfgPath);
            }
        }
    }
}

console.log('wwww', service);

self.onmessage = function (event) {
    const { data } = event;
    // console.log('ABC', data);
};
`;
}
