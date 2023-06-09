import { Hono, z } from "./deps.ts";
import * as channelRegistry from "./channel_registry.ts";

export const PlantDef = z.object({
  contracts: z.array(z.any()),
  config: z.record(z.any()).optional(),
  http: z.boolean().optional(),
  filePath: z.string().optional(),
  proc: z.string().optional(),
});
export type PlantDef = z.infer<typeof PlantDef>;

export type HttpFunction = (app: Hono<any, any, any>) => void;
export const HttpFunction: z.ZodType<HttpFunction> = z.any();

export const Field = z.object({
  plants: z.record(PlantDef),
  http: HttpFunction.optional(),
});
export type Field = z.infer<typeof Field>;

export type ValidField = {
  plants: Record<string, Required<PlantDef>>;
  http?: HttpFunction;
};

export type Proc = {
  worker: channelRegistry.IMessagePort;
  procName: string;
  plants: {
    plantName: string;
    plantDef: PlantDef;
  }[];
  procsPorts: Map<string, MessagePort>;
};

export type CallResult =
  | { type: "success"; result: any; receiver: string; callId: string }
  | {
    type: "error";
    receiver: string;
    callId: string;
    name: string;
    message: string;
  };

export type Call = {
  sessionId: string;
  requestId: string;
  caller: string;
  receiver: string;
  method: string;
  args: any[];
  callId: string;
};

export type Send = {
  args: any[];
  caller: string;
  receiver: string;
  sendId: string;
  sessionId: string;
  requestId: string;
};

export type SendAck = {
  sendId: string;
  caller: string;
  receiver: string;
};

export type MsgToWorker =
  | {
    init: {
      field: ValidField;
      proc: string;
      portNames: string[];
      config: {
        [plantName: string]: any;
      };
    };
  }
  | { call: Call }
  | { callResult: CallResult }
  | { send: Send };

export type MsgFromWorker =
  | { ready: true }
  | { initComplete: true }
  | { callResult: CallResult }
  | { sendAck: SendAck };

export type WorkerToWorkerMsg =
  | { call: Call; receiverPlant: string }
  | { callResult: CallResult; receiverPlant: string }
  | { send: Send }
  | { sendAck: SendAck };

type CallMethodCfg = {
  sessionId: string;
  requestId: string;
  plantName: string;
  methodName: string;
  args: any[];
  procs: Map<string, Proc>;
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
