/**
 * @file In-process conversation memory: the ONLY thing the brain is allowed to retain.
 *
 * The engine keeps the last 40 turns for context, which may include a phone number the customer
 * typed. The specification's rule: USE WITHIN THE TURN, REDACT BEFORE WRITING. The engine does
 * that (`redactPII` + `assertNoStoredPII`); this class is only the shelf.
 *
 * The key is (tenant, conversation), never the conversation id alone: the brain serves many
 * merchants, and a wrong key would let merchant B read merchant A's conversation.
 *
 * Used only in legacy test mode; in licensed mode memory lives on the landing (see LandingGateway).
 */

import type { ConversationId, TenantId } from "@sp/contract";
import type { ConversationState, MemoryPort } from "@sp/brain";

function memoryKey(tenant: string, conversationId: string): string {
  return `${tenant} ${conversationId}`;
}

/** Memory in RAM; a restart forgets everything, which is acceptable. */
export class InMemoryConversationMemory implements MemoryPort {
  private readonly store = new Map<string, ConversationState>();

  /** @param capacity maximum conversations kept; the oldest is dropped beyond it. */
  constructor(private readonly capacity = 5000) {}

  async load(tenant: TenantId, conversationId: ConversationId): Promise<ConversationState | null> {
    return this.store.get(memoryKey(tenant, conversationId)) ?? null;
  }

  async save(state: ConversationState): Promise<void> {
    const key = memoryKey(state.tenant, state.conversationId);
    if (!this.store.has(key) && this.store.size >= this.capacity) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, state);
  }

  conversationCount(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
