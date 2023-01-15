export type CallResult
    = { type: 'success', result: any, receiver: string, callId: string }
    | { type: 'error', error: string, receiver: string, callId: string };

export type Call = {
    caller: string;
    receiver: string;
    method: string;
    args: any[];
    callId: string;
};

export type MsgToWorker
    = { configUpdate: any }
    | { init: { config: any } }
    | { call: Call }
    | { callResult: CallResult }

export type MsgFromWorker
    = { ready: true }
    | { call: Call }
    | { callResult: { toPlant: string, result: CallResult } }
