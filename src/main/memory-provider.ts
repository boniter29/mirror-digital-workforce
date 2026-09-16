import type { EpisodicMessage } from "./episodic-store.js";

export interface ExternalMemorySearchResult {
  id: string;
  text: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface ExternalMemoryProvider {
  readonly id: string;
  initialize(): Promise<void>;
  search(query: string, limit: number): Promise<ExternalMemorySearchResult[]>;
  syncTurn(sessionId: string, messages: EpisodicMessage[]): Promise<void>;
  close(): Promise<void>;
}

/**
 * 只允许挂载一个外部记忆 Provider。内置 MEMORY.md / USER.md 与本地 FTS5
 * 永远保留，外部 Provider 只能作为附加层，不能替代核心身份记忆。
 */
export class ExternalMemorySlot {
  private provider?: ExternalMemoryProvider;

  get activeId(): string | null {
    return this.provider?.id ?? null;
  }

  async attach(provider: ExternalMemoryProvider): Promise<void> {
    if (this.provider && this.provider !== provider) throw new Error(`已有外部记忆 Provider：${this.provider.id}。请先关闭后再切换。`);
    await provider.initialize();
    this.provider = provider;
  }

  async search(query: string, limit = 5): Promise<ExternalMemorySearchResult[]> {
    return this.provider ? this.provider.search(query, limit) : [];
  }

  async syncTurn(sessionId: string, messages: EpisodicMessage[]): Promise<void> {
    if (this.provider) await this.provider.syncTurn(sessionId, messages);
  }

  async close(): Promise<void> {
    if (this.provider) await this.provider.close();
    this.provider = undefined;
  }
}
