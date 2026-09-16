import { describe, expect, it, vi } from "vitest";
import { HttpDeliveryError, KeyedSerialQueue, retryDelivery } from "../src/main/reliable-delivery";

describe("DingTalk reliable delivery", () => {
  it("keeps messages in one conversation in arrival order", async () => {
    const queue = new KeyedSerialQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.run("group-1", async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
    });
    const second = queue.run("group-1", async () => { events.push("second"); });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("does not block a different conversation", async () => {
    const queue = new KeyedSerialQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.run("group-1", () => gate);
    const second = queue.run("group-2", async () => "done");
    await expect(second).resolves.toBe("done");
    release();
    await first;
  });

  it("retries transient HTTP failures and reports the next attempt", async () => {
    const retries = vi.fn();
    const operation = vi.fn(async (attempt: number) => {
      if (attempt < 3) throw new HttpDeliveryError("temporary", 503);
      return "sent";
    });

    await expect(retryDelivery(operation, { attempts: 3, delaysMs: [0, 0], sleep: async () => undefined, onRetry: retries })).resolves.toBe("sent");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(retries).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent DingTalk rejections", async () => {
    const operation = vi.fn(async () => { throw new HttpDeliveryError("forbidden", 403); });
    await expect(retryDelivery(operation, { attempts: 3, sleep: async () => undefined })).rejects.toThrow("forbidden");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
