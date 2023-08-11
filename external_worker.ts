import { IMessagePort } from "./channel_registry.ts";
import {
  ISubscription,
  IWorkerCommunication,
  MsgFromWorker,
  ValidField,
} from "./types.ts";

export class ExternalWorker extends EventTarget implements IMessagePort {
  private commSubscription?: ISubscription;
  private process?: Deno.ChildProcess;
  private url?: string;

  constructor(
    private comm: IWorkerCommunication,
    private field: ValidField,
    private procName: string,
  ) {
    super();
    this.onMsg = this.onMsg.bind(this);
    this.start();
  }

  private onMsg(msg: MsgFromWorker): void {
    const event: any = new Event("message");
    event.data = msg;
    this.dispatchEvent(event);
  }

  // deno-lint-ignore require-await
  private async start(): Promise<void> {
    this.commSubscription = this.comm.subscribe(this.procName, this.onMsg);
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

    this.url = this.field.procs[this.procName]?.url;
  }

  public terminate(): void {
    this.commSubscription?.cancel();
    this.process?.kill();
  }

  public postMessage(msg: any, _transfer: any[]) {
    this.comm.sendMsg(this.procName, msg);

    if (!this.url) {
      throw new Error("worker not initialized properly, url missng");
    }
  }
}
