import { IMessagePort } from "./channel_registry.ts";
import {
  ISubscription,
  IWorkerCommunication,
  MsgFromWorker,
  MsgToWorker,
  ValidField,
} from "./types.ts";

import { getLogger, Logger } from "./logger.ts";

export class ExternalWorker extends EventTarget implements IMessagePort {
  private commSubscription?: ISubscription;
  private process?: Deno.ChildProcess;
  private url?: string;
  private log = getLogger({ name: "ExternalWorker" });

  constructor(
    private comm: IWorkerCommunication,
    private field: ValidField,
    private procName: string,
  ) {
    super();
    this.onMsg = this.onMsg.bind(this);
    this.commSubscription = this.comm.subscribe(this.procName, this.onMsg);
    this.start();
  }

  private onMsg(msg: MsgFromWorker): void {
    const event: any = new Event("message");
    event.data = msg;
    this.dispatchEvent(event);
  }

  // deno-lint-ignore require-await
  private async start(): Promise<void> {
    const procConfig = this.field.procs[this.procName];

    if (!procConfig) {
      throw new Error("configuration for proc not found" + this.procName);
    }

    const command = new Deno.Command(procConfig?.cmd?.[0] ?? "", {
      args: procConfig?.cmd?.slice(1),
      cwd: procConfig.cwd,
      env: {
        FIELD: JSON.stringify(this.field),
        PROC_NAME: this.procName,
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    this.process = command.spawn();

    this.process.status.then((status) => {
      if (status.code !== 0 && status.signal !== "SIGTERM") {
        this.log.warning("restarting");
        this.start();
      }
    });

    this.url = this.field.procs[this.procName]?.url;

    globalThis.addEventListener("unload", () => {
      this.terminate();
    });
  }

  public terminate(): void {
    this.commSubscription?.cancel();
    this.process?.kill();
  }

  public postMessage(msg: MsgToWorker, transfer: any[]) {
    this.comm.sendMsg(this.procName, msg)
      .catch((err) => {
        if (err.name === "TypeError") {
          this.log.warning(err, "sending msg to worker failed");

          if ("call" in msg) {
            this.onMsg({
              callResult: {
                type: "error",
                receiver: msg.call.caller,
                callId: msg.call.callId,
                name: "crash",
                message: "proc crashed",
              },
            });
          }
        }
      });
    //   .catch(async (err) => {
    //   this.log.error(err, "calling external worker failed");
    //
    //   if (err.name === "TypeError") {
    //     this.log.warning("service crashed, restarting");
    //     await this.start();
    //     return this.postMessage(msg, transfer);
    //   }
    // });
  }
}
