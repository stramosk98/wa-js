/*!
 * Copyright 2026 WPPConnect Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ConversationSession, PersistedIncomingMessagePayload } from './types';

interface PendingConversation {
  messages: PersistedIncomingMessagePayload[];
  timer?: NodeJS.Timeout;
}

export class ConversationState {
  private readonly activeChats = new Set<string>();
  private readonly queuedMessages = new Map<
    string,
    PersistedIncomingMessagePayload[]
  >();
  private readonly pendingChats = new Map<string, PendingConversation>();

  constructor(
    private readonly debounceMs: number,
    private readonly sessionTtlMs: number
  ) {}

  isExpired(session: ConversationSession): boolean {
    const lastActivity = session.lastCustomerMessageAt || session.updatedAt;

    return Date.now() - lastActivity > this.sessionTtlMs;
  }

  isActive(chatId: string): boolean {
    return this.activeChats.has(chatId);
  }

  setActive(chatId: string, active: boolean): void {
    if (active) {
      this.activeChats.add(chatId);
      return;
    }

    this.activeChats.delete(chatId);
  }

  consumeQueued(chatId: string): PersistedIncomingMessagePayload[] {
    const queued = this.queuedMessages.get(chatId) || [];

    this.queuedMessages.delete(chatId);

    return queued;
  }

  enqueue(
    payload: PersistedIncomingMessagePayload,
    onReady: (messages: PersistedIncomingMessagePayload[]) => void
  ): void {
    const pending = this.pendingChats.get(payload.chatId) || { messages: [] };

    pending.messages.push(payload);

    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    pending.timer = setTimeout(() => {
      this.pendingChats.delete(payload.chatId);
      if (this.isActive(payload.chatId)) {
        this.queuedMessages.set(payload.chatId, pending.messages);
        return;
      }

      onReady(pending.messages);
    }, this.debounceMs);

    this.pendingChats.set(payload.chatId, pending);
  }
}
