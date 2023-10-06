import { Context, Hono, log } from "./deps.ts";
import { getLogger, Logger } from "./logger.ts";
import {
  ISubscription,
  IWorkerCommunication,
  MsgFromExternalWorker,
  ValidField,
} from "./types.ts";

export function hasExternalProcs(field: ValidField): boolean {
  return Object.keys(field.procs).some((procName) => {
    return field.procs[procName].cmd !== undefined;
  });
}

export class HttpComm implements IWorkerCommunication {
  private app!: Hono;
  private subscriptions: {
    [procName: string]: ((msg: MsgFromExternalWorker) => void)[];
  } = {};
  private logger: Logger = getLogger({ name: "HttpComm" });
  private abort: AbortController = new AbortController();
  private server!: Deno.Server;

  constructor(private field: ValidField, port: number) {
    if (!hasExternalProcs(field)) {
      return new HttpCommPassThrough() as any;
    }

    this.onMsg = this.onMsg.bind(this);
    this.app = new Hono();
    this.app.post("/grow/msg", this.onMsg);

    this.server = Deno.serve({
      port,
      signal: this.abort.signal,
    }, this.app.fetch);
  }

  public close(): Promise<void> {
    this.abort.abort("close");
    return this.server.finished;
  }

  private async onMsg(c: Context) {
    let data: any;

    try {
      data = await c.req.json();
    } catch (err) {
      log.error(err, "parsing request failed");
      c.status(400);
      return c.json({ error: "badRequest" });
    }
    const procName = data.procName;
    const subscriptions = this.subscriptions[procName] || [];

    subscriptions.forEach((sub) => sub(data));

    return c.json({ ok: true });
  }

  public subscribe(
    procName: string,
    func: (msg: MsgFromExternalWorker) => void,
  ): ISubscription {
    this.subscriptions[procName] = this.subscriptions[procName] || [];
    this.subscriptions[procName].push(func);

    return {
      cancel: () => {
        this.subscriptions[procName] = this.subscriptions[procName]
          .filter((f) => f !== func);
      },
    };
  }

  public async sendMsg(procName: string, msg: any): Promise<void> {
    const url = this.field.procs[procName]?.url;

    if (!url) {
      throw new Error("worker not initialized properly, url missng");
    }

    const request = await fetch(url + "/grow/msg", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "communication-secret": this.field.communicationSecret,
      },
      body: JSON.stringify(msg),
    });

    const text = await request.text();

    try {
      const json = JSON.parse(text);
      const subscriptions = this.subscriptions[procName] || [];

      subscriptions.forEach((sub) => sub(json));
    } catch (err) {
      this.logger.error(err, "parsing failed");
      throw new Error("callFailed");
    }
  }
}

export class HttpCommPassThrough implements IWorkerCommunication {
  constructor() {
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }

  public subscribe(
    _procName: string,
    _func: (msg: MsgFromExternalWorker) => void,
  ): ISubscription {
    return {
      cancel: () => {},
    };
  }

  public sendMsg(_procName: string, _msg: any): Promise<void> {
    return Promise.resolve();
  }
}
