import { Reflect } from "reflect-metadata";
import * as _ from 'lodash';
import { match, P } from "ts-pattern";
import type { MsgToWorker, Call, CallResult } from './messages.ts';
import { Deferred, defer } from "./defer.ts";

const url = new URL(import.meta.url);
const plantName = url.searchParams.get('plantName');
const servicePath = url.searchParams.get('servicePath');

if (!plantName || !servicePath) {
    throw new Error("Missing plantName or servicePath");
}

const mod = await import(`${servicePath}.ts`);
const plant = new mod[plantName]();
const calls = new Map<string, Deferred<any>>();

self.onmessage = (event: MessageEvent) => {
    match(event.data as MsgToWorker)
        .with({ init: { config: P.select() } }, (config) => {
            updateConfig(config);
            initInjectables(plant);
        })
        .with({ configUpdate: P.select() }, (config) => {
            updateConfig(config);
        })
        .with({ call: P.select() }, (call) => {
            callPlant(call);
        })
        .with({ callResult: P.select() }, (result) => {
            manageResult(result);
        })
        .exhaustive();
}

self.postMessage({ ready: true });

function manageResult(result: CallResult) {
    const deferred = calls.get(result.callId);

    if (!deferred) {
        return;
    }

    calls.delete(result.callId);

    match(result)
        .with({ type: "success", result: P.select() }, (result) => {
            deferred.resolve(result);
        })
        .with({ type: "error", error: P.select() }, (error) => {
            deferred.reject(error);
        })
        .exhaustive();
}

async function callPlant(call: Call) {
    try {
        const result = await plant[call.method](...call.args);
        self.postMessage({
            callResult: {
                type: "success",
                result,
                callId: call.callId,
                receiver: call.caller,
            }
        });
    } catch (err) {
        self.postMessage({
            callResult: {
                callId: call.callId,
                receiver: call.caller,
                type: "error",
                error: (err as any)?.message
                    ?? `calling ${plantName}.${call.method}() failed`,
            }
        });
    }
}

function initInjectables(plant: any) {
    for (const key of Object.keys(plant)) {
        const meta = Reflect.getMetadata('inject', plant, key)
        if (!meta) {
            continue;
        }
        plant[key] = buildProxy(meta);
    }
}

function buildProxy(targetService: string) {
    return new Proxy({}, {
        get: (_target, prop) => {
            if (prop === 'then') {
                return undefined;
            }
            return (...args: any[]) => {
                const callId = crypto.randomUUID();
                const deferred = defer();

                calls.set(callId, deferred);

                self.postMessage({
                    call: {
                        method: prop,
                        args,
                        caller: plantName,
                        receiver: targetService,
                        callId
                    } as Call
                });

                return deferred.promise;
            }
        }
    });
}

function updateConfig(config: any) {
    for (const key of Object.keys(plant)) {
        const configPath = Reflect.getMetadata('config', plant, key);
        if (configPath) {
            plant[key] = _.get(config, configPath, undefined);
        }
    }
}
