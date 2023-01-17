import { z } from "zod";

export const PlantDef = z.object({
  contracts: z.array(z.any()),
  config: z.record(z.any()).optional(),
  http: z.boolean().optional(),
});
export type PlantDef = z.infer<typeof PlantDef>;

export const Field = z.object({
  debug: z.boolean().optional(),
  plants: z.record(PlantDef),
});
export type Field = z.infer<typeof Field>;

export type Service = {
  worker: Worker;
  plantDef: PlantDef;
  plantName: string;
};

export type CallResult =
  | { type: "success"; result: any; receiver: string; callId: string }
  | { type: "error"; error: string; receiver: string; callId: string };

export type Call = {
  caller: string;
  receiver: string;
  method: string;
  args: any[];
  callId: string;
};

export type MsgToWorker =
  | { configUpdate: any }
  | { init: { config: any; toInject: string[] } }
  | { inject: { plantName: string } }
  | { call: Call }
  | { callResult: CallResult };

export type MsgFromWorker =
  | { ready: { toInject: string[] } }
  | { callResult: CallResult };

export type WorkerToWorkerMsg =
  | { call: Call }
  | { callResult: CallResult };

type CallMethodCfg = {
  plantName: string;
  methodName: string;
  args: any[];
  instances: Record<string, Service>;
};

export type CallMethod = (cfg: CallMethodCfg) => Promise<CallResult>;
