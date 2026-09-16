export class RecentReplyGuard {
  private readonly incoming = new Map<string, number>();
  private readonly replies = new Map<string, Array<{ text: string; at: number }>>();

  acceptIncoming(scope: string, text: string, windowMs = 90_000): boolean {
    const now = Date.now();
    const key = `${scope}:${normalize(text)}`;
    const previous = this.incoming.get(key);
    this.incoming.set(key, now);
    for (const [item, at] of this.incoming) if (now - at > 10 * 60_000) this.incoming.delete(item);
    return !previous || now - previous >= windowMs;
  }

  acceptReply(scope: string, text: string, windowMs = 15 * 60_000): boolean {
    const now = Date.now();
    const recent = (this.replies.get(scope) ?? []).filter((item) => now - item.at < windowMs);
    const duplicate = recent.some((item) => similarity(item.text, text) >= 0.82);
    if (!duplicate) recent.push({ text, at: now });
    this.replies.set(scope, recent.slice(-12));
    return !duplicate;
  }
}

export function similarity(left: string, right: string): number {
  const a = bigrams(normalize(left));
  const b = bigrams(normalize(right));
  if (!a.size || !b.size) return normalize(left) === normalize(right) ? 1 : 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

export function normalize(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "").slice(0, 4_000);
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  if (value.length === 1) result.add(value);
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
  return result;
}
