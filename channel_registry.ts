export type IMessagePort = EventTarget & {
  postMessage(message: any, transfer?: Transferable[]): void;
};

class Port extends EventTarget implements IMessagePort {
  public theOtherEnd!: IMessagePort;
  public onmessage?: (message: any, transfer?: Transferable[]) => void;

  constructor() {
    super();

    this.addEventListener("message", (event: any) => {
      this.onmessage?.(event.data);
    });
  }

  postMessage(message: any, transfer?: Transferable[]): void {
    const event = new MessageEvent("message", { data: message });
    (event as any).ports = transfer;
    setTimeout(() => this.theOtherEnd.dispatchEvent(event), 0);
  }
}

class Channel {
  private _port1: IMessagePort;
  private _port2: IMessagePort;

  constructor() {
    this._port1 = new Port();
    this._port2 = new Port();
    (this._port1 as Port).theOtherEnd = this._port2;
    (this._port2 as Port).theOtherEnd = this._port1;
  }

  get port1(): IMessagePort {
    return this._port1;
  }

  get port2(): IMessagePort {
    return this._port2;
  }
}

const ports = new Map<string, IMessagePort>();

export function createChannel(procName: string): IMessagePort {
  const ch = new Channel();
  ports.set(procName, ch.port1);
  return ch.port2;
}

export function getPort(procName: string): IMessagePort | undefined {
  return ports.get(procName);
}
