import { Reflect } from "reflect-metadata";
import * as _ from 'lodash';

const url = new URL(import.meta.url);
const plantName = url.searchParams.get('plantName');
const servicePath = url.searchParams.get('servicePath');

const mod = await import(`${servicePath}.ts`);

const plant = new mod[plantName]();

self.onmessage = (event) => {
    if (event.data.type === "config") {
        updateConfig(event.data.config);
    }
};

self.postMessage({ type: "ready" });

function updateConfig(config) {
    for (const [key] of Object.entries(plant)) {
        const configPath = Reflect.getMetadata('config', plant, key);
        if (configPath) {
            plant[key] = _.get(config, configPath);
        }
    }
}

// // @ts-ignore
// import { $serviceName } from "$dir/$workerFileName";
// import * as _ from "lodash";

// declare const $config: any;

// const service = new $serviceName();

// for (const [prop, value] of Object.entries($serviceName.prototype) as any) {
//     if (!value?.___growDecorator) {
//         continue;
//     }

//     if (value.type === 'config') {
//         service[prop] = $config
//     };
//     if (value.cfgPath) {
//         service[prop] = _.get(service[prop], value.cfgPath);
//     }
// }

// console.log('wwww', service.access);

// self.onmessage = function(event) {
//     const { data } = event;
//     console.log('ABC', data);
// };
