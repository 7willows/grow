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
  | { callResult: { toPlant: string; result: CallResult } };

export type WorkerToWorkerMsg =
  | { call: Call }
  | { callResult: CallResult };
