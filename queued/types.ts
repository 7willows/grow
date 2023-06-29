import { Call } from "../types.ts";

export type QueueItemToStore = Call & {};

export type QueueItemRetrieved =
  & QueueItemToStore
  & {
    queuedAt: number;
    attemptedAt: number[];
    acknowledgedAt: number | null;
  };

export type FindCriteria = {
  requestsIds: string[];
} | {
  acknowledged: false;
  lastAttemptBefore: number;
};
