import { Call } from "../types.ts";
import { QueueAccess } from "./queue_access.ts";

const TIMEOUT = 60 * 1000;
const queue = new QueueAccess();

export async function addToQue(call: Call) {
  await queue.add(call);
}

export async function runCalls() {
  const callsToRun = await queue.find({
    acknowledged: false,
    lastAttemptBefore: Date.now() - TIMEOUT,
  });

  await queue.recordAttempts(callsToRun?.map((c) => c.requestId));

  for (const c of callsToRun) {
    const ack = true;
    // todo: run calls
    if (ack) {
      await queue.recordAcks([c.requestId]);
    }
  }
}
