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

import {
  ConversationSession,
  ConversationStatus,
  IncomingMessagePayload,
} from './types';

interface PendingConversation {
  messages: IncomingMessagePayload[];
  timer?: NodeJS.Timeout;
}

export class ConversationState {
  private readonly activeChats = new Set<string>();
  private readonly processedMessages = new Set<string>();
  private readonly queuedMessages = new Map<string, IncomingMessagePayload[]>();
  private readonly pendingChats = new Map<string, PendingConversation>();
  private readonly sessions = new Map<string, ConversationSession>();

  constructor(
    private readonly debounceMs: number,
    private readonly sessionTtlMs: number
  ) {}

  appendMessages(chatId: string, messages: IncomingMessagePayload[]): void {
    const session = this.getOrCreateSession(chatId);
    const now = Date.now();

    session.recentMessages.push(...messages);
    session.recentMessages = session.recentMessages.slice(-20);
    session.lastCustomerMessageAt = now;
    session.updatedAt = now;
  }

  getOrCreateSession(chatId: string): ConversationSession {
    const session = this.sessions.get(chatId);

    if (session) {
      return session;
    }

    const now = Date.now();
    const newSession: ConversationSession = {
      chatId,
      createdAt: now,
      recentMessages: [],
      status: 'new',
      transitions: [],
      updatedAt: now,
    };

    this.sessions.set(chatId, newSession);

    return newSession;
  }

  isProcessed(messageId: string): boolean {
    return this.processedMessages.has(messageId);
  }

  markProcessed(messageId: string): void {
    this.processedMessages.add(messageId);
  }

  markBotMessage(chatId: string): void {
    const session = this.getOrCreateSession(chatId);
    const now = Date.now();

    session.lastBotMessageAt = now;
    session.updatedAt = now;
  }

  markHumanHandoff(chatId: string, reason: string): ConversationSession {
    const session = this.setStatus(chatId, 'waiting_human', reason);

    session.handoffReason = reason;

    return session;
  }

  markResolved(chatId: string, reason = 'resolved'): ConversationSession {
    const session = this.setStatus(chatId, 'resolved', reason);

    session.resolvedAt = Date.now();

    return session;
  }

  markOptOut(chatId: string, reason = 'opt_out'): ConversationSession {
    const session = this.setStatus(chatId, 'opted_out', reason);

    session.optOutAt = Date.now();

    return session;
  }

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

  setSelectedMenuOption(chatId: string, option: string): void {
    const session = this.getOrCreateSession(chatId);

    session.selectedMenuOption = option;
    session.updatedAt = Date.now();
  }

  setStatus(
    chatId: string,
    status: ConversationStatus,
    reason: string
  ): ConversationSession {
    const session = this.getOrCreateSession(chatId);

    if (session.status === status) {
      session.updatedAt = Date.now();
      return session;
    }

    const now = Date.now();

    session.transitions.push({
      from: session.status,
      reason,
      timestamp: now,
      to: status,
    });
    session.status = status;
    session.updatedAt = now;

    return session;
  }

  consumeQueued(chatId: string): IncomingMessagePayload[] {
    const queued = this.queuedMessages.get(chatId) || [];

    this.queuedMessages.delete(chatId);

    return queued;
  }

  enqueue(
    payload: IncomingMessagePayload,
    onReady: (messages: IncomingMessagePayload[]) => void
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
