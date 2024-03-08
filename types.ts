import { Hono } from "./deps.ts";
import * as channelRegistry from "./channel_registry.ts";

export type PlantDef = {
  contracts?: any[];
  config?: Record<string, any>;
  http?: boolean;
  filePath?: string;
  proc?: string;
};

export type HttpFunction = (app: Hono<any, any, any>) => void;

export type ProcDef = {
  cwd?: string;
  cmd?: string[];
  url?: string;
  restartOnError?: boolean;
};
export type ValidProcDef = {
  cwd: string;
  cmd: string[];
  url: string;
  restartOnError: boolean;
};

export type ValidPlantDef = {
  cwd?: string;
  cmd?: string[];
  url?: string;
  restartOnError?: boolean;
};

export type Field = {
  comunicationSecret?: string;
  plants: Record<string, PlantDef>;
  procs: Record<string, ProcDef>;
  http?: HttpFunction;
};

export type ValidField = {
  communicationSecret: string;
  plants: Record<string, Required<PlantDef>>;
  procs: Record<string, ValidProcDef>;
  http?: HttpFunction;
};

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
