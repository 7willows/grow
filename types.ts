import { Hono, z } from "./deps.ts";

export const PlantDef = z.object({
  contracts: z.array(z.any()),
  config: z.record(z.any()).optional(),
  http: z.boolean().optional(),
  filePath: z.string().optional(),
});
export type PlantDef = z.infer<typeof PlantDef>;

export type HttpFunction = (app: Hono<any, any, any>) => void;
export const HttpFunction: z.ZodType<HttpFunction> = z.any();

export const Field = z.object({
  plants: z.record(PlantDef),
  http: HttpFunction.optional(),
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
  sessionId: string;
  requestId: string;
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
  | { initialized: true }
  | { callResult: CallResult };

export type WorkerToWorkerMsg =
  | { call: Call }
  | { callResult: CallResult };

type CallMethodCfg = {
  sessionId: string;
  requestId: string;
  plantName: string;
  methodName: string;
  args: any[];
  instances: Record<string, Service>;
};

export type CallMethod = (cfg: CallMethodCfg) => Promise<CallResult>;

export type GrowClient = {
  plant<T>(plantName: string): T;
  sessionId: string | null;
  addEventListener(eventType: string, listener: (event: any) => void): void;
  removeEventListener(
    eventType: string,
    listener: (event: any) => void,
  ): void;
  dispatchEvent(event: any): void;
};
