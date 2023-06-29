import { FindCriteria, QueueItemRetrieved, QueueItemToStore } from "./types.ts";

export class QueueAccess {
  constructor() {
  }

  private queue: Record<string, QueueItemRetrieved> = {};

  public async add(item: QueueItemToStore) {
    const queuedItem: QueueItemRetrieved = {
      ...item,
      queuedAt: Date.now(),
      attemptedAt: [],
      acknowledgedAt: null,
    };
    this.queue[item.requestId] = queuedItem;
  }

  public async find(findCriteria: FindCriteria) {
    if ("requestsIds" in findCriteria) {
      return Object.values(this.queue).filter((i) => {
        i.requestId in findCriteria.requestsIds;
      });
    }
    if ("lastAttemptBefore" in findCriteria) {
      return Object.values(this.queue).filter((i) => {
        i.acknowledgedAt === null &&
          (Math.max(...i.attemptedAt) ?? 0) < findCriteria.lastAttemptBefore;
      });
    }
    return [];
  }

  public async recordAttempts(requestsIds: string[]) {
    for (const rid of requestsIds) {
      this.queue[rid].attemptedAt.push(Date.now());
    }
  }

  public async recordAcks(requestsIds: string[]) {
    for (const rid of requestsIds) {
      this.queue[rid].acknowledgedAt = Date.now();
    }
  }
}
