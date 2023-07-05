import { Logger } from "./logger.ts";
import { Send, SendAck } from "./types.ts";

const MAX_TRIES = 3;
const TIMEOUT = 500;

type Queue = {
  items: Item[];
  name: string;
};

type Item = {
  send: Send;
  state: "ready" | "unacked";
  tries: number;
  addedAt: Date;
  lastTriedAt?: Date;
};

export class Queues {
  private queues: { [queueName: string]: Queue } = {};

  constructor(
    private log: Logger,
    private doSend: (send: Send) => void,
  ) {}

  private getQueue(queueName: string): Queue {
    if (!this.queues[queueName]) {
      this.queues[queueName] = {
        items: [],
        name: queueName,
      };
    }

    return this.queues[queueName];
  }

  public enqueue(send: Send): void {
    const queue = this.getQueue(send.receiver);
    const now = new Date();
    queue.items.push({
      send,
      tries: 0,
      addedAt: now,
      state: "ready",
    });
    this.kick(queue.name);
  }

  public onAck(sendAck: SendAck): void {
    const queue = this.getQueue(sendAck.receiver);
    queue.items = queue.items.filter((item) => {
      if (item.send.sendId === sendAck.sendId) {
        this.log.debug(`Acked ${sendAck.sendId}`);
        return false;
      }
      return true;
    });

    this.kick(sendAck.receiver);
  }

  private kick(queueName: string): void {
    this.timeoutCheck();

    const queue = this.getQueue(queueName);

    const queueIsWaiting = queue.items.find((item) => item.state === "unacked");

    if (queueIsWaiting) {
      return;
    }

    const item = queue.items[0];

    if (!item) {
      return;
    }

    if (item.tries >= MAX_TRIES) {
      this.log.error("max tries reached, dropping message", item.send);
      queue.items = queue.items.filter((it) => it !== item);
      setTimeout(() => this.kick(queueName), 0);
      return;
    }

    item.tries += 1;
    item.lastTriedAt = new Date();
    item.state = "unacked";

    this.doSend(item.send);
  }

  private timeoutCheck() {
    for (const queue of Object.values(this.queues)) {
      for (const item of queue.items) {
        if (item.lastTriedAt) {
          const diff = new Date().getTime() - item.lastTriedAt.getTime();
          if (diff > TIMEOUT) {
            this.log.debug("timeout reached, re-adding message", item.send);
            item.state = "ready";
            queue.items = queue.items.filter((it) => it !== item);
            queue.items.push(item);
          }
        }
      }
    }
  }
}
