import { Context, Hono, z } from "./deps.ts";
import * as channelRegistry from "./channel_registry.ts";

export const PlantDef = z.object({
  contracts: z.array(z.any()).optional(),
  config: z.record(z.any()).optional(),
  http: z.boolean().optional(),
  filePath: z.string().optional(),
  proc: z.string().optional(),
});
export type PlantDef = z.infer<typeof PlantDef>;

export type HttpFunction = (app: Hono<any, any, any>) => void;
export const HttpFunction: z.ZodType<HttpFunction> = z.any();

export const ProcDef = z.object({
  cwd: z.string().optional(),
  cmd: z.string().array().optional(),
  url: z.string().optional(),
  restartOnError: z.boolean().optional(),
});
export type ProcDef = z.infer<typeof ProcDef>;

export const ValidProcDef = z.object({
  cwd: z.string().optional(),
  cmd: z.string().array().optional(),
  url: z.string(),
  restartOnError: z.boolean(),
});
export type ValidProcDef = z.infer<typeof ValidProcDef>;

export type Ctx<T = any> = {
  sessionId?: string;
  requestId: string;
  data: T;
};

export type GrowConfig<T = any> = {
  sessionId?: string;
  requestId?: string;
  ctx?: Ctx<T>;
};

export type ConfigurableInject<T, U = any> = (
  cfg: (x: GrowConfig<U>) => GrowConfig<U>,
) => T;

export type Field = {
  communicationSecret?: string;
  plants: Record<string, PlantDef>;
  procs?: Record<string, ProcDef>;
  http?: HttpFunction;
  initCtx?: (c: Context, ctx: Ctx) => Ctx;
};

export type ValidField = {
  communicationSecret: string;
  plants: Record<string, Required<PlantDef>>;
  procs: Record<string, ValidProcDef>;
  http?: HttpFunction;
  initCtx: (c: Context | null, ctx: Ctx) => Ctx;
};

export type ClonedField = Omit<ValidField, "initCtx">;

declare type MessagePort = any;

export type Proc = {
  worker: channelRegistry.IMessagePort;
  cmd?: string[];
  cwd?: string;
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
  ctx: Ctx;
  caller: string;
  receiver: string;
  method: string;
  args: any[];
  callId: string;
};

export type Send = {
  args: any[];
  caller: string;
  receiverProc: string;
  receiver: string;
  sendId: string;
  sessionId: string;
  requestId: string;
  ctx: Ctx;
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
  | {
    reinit: {
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
  | { send: Send }
  | { kill: true };

export type MsgFromWorker =
  | { ready: true }
  | { initComplete: true }
  | { callResult: CallResult }
  | { sendAck: SendAck }
  | { restartMe: true };

export type MsgFromExternalWorker = MsgFromWorker & {
  procName: string;
};

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
  ctx: Ctx;
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

export interface ISubscription {
  cancel(): void;
}

export interface IWorkerCommunication {
  subscribe(
    procName: string,
    func: (msg: MsgFromExternalWorker) => void,
  ): ISubscription;
  sendMsg(procName: string, msg: MsgToWorker): Promise<void>;
  close(): Promise<void>;
}
