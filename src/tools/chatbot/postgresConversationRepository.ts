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

import { Pool, PoolClient } from 'pg';

import {
  ConversationRepository,
  ConversationStatus,
  IncomingMessagePayload,
  LlmFailedInput,
  LlmStartedInput,
  LlmSucceededInput,
  OutboundMessageInput,
  PersistedConversationSession,
  PersistedIncomingMessagePayload,
  ToolCallInput,
  TransitionInput,
} from './types';

interface ContactRow {
  id: string;
  opted_out_at: Date | null;
}

interface ConversationRow {
  assigned_agent: string | null;
  chat_id: string;
  contact_id: string;
  created_at: Date;
  expires_at: Date | null;
  handoff_reason: string | null;
  id: string;
  last_bot_message_at: Date | null;
  last_customer_message_at: Date | null;
  resolved_at: Date | null;
  selected_menu_option: string | null;
  status: number;
  updated_at: Date;
}

interface MessageRow {
  id: string;
}

export class PostgresConversationRepository implements ConversationRepository {
  constructor(
    private readonly pool: Pool,
    private readonly sessionTtlMs: number
  ) {}

  async ingestInboundMessage(
    payload: IncomingMessagePayload
  ): Promise<PersistedIncomingMessagePayload | undefined> {
    const client = await this.pool.connect();

    try {
      await client.query('begin');

      const contact = await this.findOrCreateContact(client, payload.chatId);
      const conversation = await this.findOrCreateConversation(
        client,
        contact,
        payload.chatId
      );
      const inserted = await client.query<MessageRow>(
        `
          insert into messages (
            conversation_id,
            contact_id,
            chat_id,
            wa_message_id,
            direction,
            sender_type,
            message_type,
            body,
            raw_payload,
            created_at
          )
          values ($1, $2, $3, $4, 'inbound', 'customer', $5, $6, $7::jsonb, $8)
          on conflict (wa_message_id) where wa_message_id is not null do nothing
          returning id
        `,
        [
          conversation.id,
          contact.id,
          payload.chatId,
          payload.messageId,
          payload.type || 'chat',
          payload.body,
          JSON.stringify(sanitizePayload(payload)),
          payload.timestamp ? new Date(payload.timestamp * 1000) : new Date(),
        ]
      );

      if (!inserted.rows.length) {
        await client.query('commit');
        return undefined;
      }

      await client.query(
        `
          update conversations
          set
            last_customer_message_at = $2,
            updated_at = now(),
            expires_at = $3
          where id = $1
        `,
        [
          conversation.id,
          payload.timestamp ? new Date(payload.timestamp * 1000) : new Date(),
          new Date(Date.now() + this.sessionTtlMs),
        ]
      );

      await client.query('commit');

      if (contact.opted_out_at || conversation.status === toDbStatus('open')) {
        return undefined;
      }

      return {
        ...payload,
        contactId: Number(contact.id),
        conversationId: Number(conversation.id),
        dbMessageId: Number(inserted.rows[0].id),
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async getConversation(
    conversationId: number
  ): Promise<PersistedConversationSession | undefined> {
    const result = await this.pool.query<ConversationRow>(
      `
        select *
        from conversations
        where id = $1
      `,
      [conversationId]
    );

    return result.rows[0] ? toSession(result.rows[0]) : undefined;
  }

  async transitionConversation(
    input: TransitionInput
  ): Promise<PersistedConversationSession> {
    const client = await this.pool.connect();

    try {
      await client.query('begin');

      const current = await this.lockConversation(client, input.conversationId);

      const toStatus = toDbStatus(input.toStatus);

      if (current.status !== toStatus) {
        await client.query(
          `
            insert into conversation_transitions (
              conversation_id,
              from_status,
              to_status,
              reason,
              metadata
            )
            values ($1, $2, $3, $4, $5::jsonb)
          `,
          [
            current.id,
            current.status,
            toStatus,
            input.reason,
            JSON.stringify(input.metadata || {}),
          ]
        );
      }

      const updated = await client.query<ConversationRow>(
        `
          update conversations
          set
            status = $2,
            handoff_reason = case when $2 = 1 then $3 else handoff_reason end,
            resolved_at = case when $2 = 2 then now() else null end,
            updated_at = now()
          where id = $1
          returning *
        `,
        [current.id, toStatus, input.reason]
      );

      await client.query('commit');

      return toSession(updated.rows[0]);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async setSelectedMenuOption(
    conversationId: number,
    option: string
  ): Promise<void> {
    await this.pool.query(
      `
        update conversations
        set selected_menu_option = $2,
            updated_at = now()
        where id = $1
      `,
      [conversationId, option]
    );
  }

  async markContactOptedOut(contactId: number): Promise<void> {
    await this.pool.query(
      `
        update contacts
        set opted_out_at = coalesce(opted_out_at, now()),
            updated_at = now()
        where id = $1
      `,
      [contactId]
    );
  }

  async recordOutboundMessage(input: OutboundMessageInput): Promise<void> {
    await this.pool.query(
      `
        insert into messages (
          conversation_id,
          contact_id,
          chat_id,
          wa_message_id,
          direction,
          sender_type,
          message_type,
          body,
          raw_payload
        )
        values ($1, $2, $3, $4, 'outbound', $5, $6, $7, $8::jsonb)
      `,
      [
        input.conversationId,
        input.contactId,
        input.chatId,
        input.waMessageId,
        input.senderType || 'bot',
        input.messageType || 'chat',
        input.body,
        JSON.stringify(sanitizePayload(input.rawPayload || {})),
      ]
    );

    await this.pool.query(
      `
        update conversations
        set last_bot_message_at = now(),
            updated_at = now()
        where id = $1
      `,
      [input.conversationId]
    );
  }

  async recordLlmStarted(input: LlmStartedInput): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      `
        insert into llm_calls (
          conversation_id,
          message_id,
          model,
          status,
          prompt_summary,
          request_payload
        )
        values ($1, $2, $3, 'started', $4, $5::jsonb)
        returning id
      `,
      [
        input.conversationId,
        input.messageId,
        input.model,
        input.promptSummary,
        JSON.stringify(sanitizePayload(input.requestPayload || {})),
      ]
    );

    return Number(result.rows[0].id);
  }

  async recordLlmSucceeded(input: LlmSucceededInput): Promise<void> {
    await this.pool.query(
      `
        update llm_calls
        set
          status = 'succeeded',
          response_text = $2,
          request_payload = $3::jsonb,
          response_payload = $4::jsonb,
          prompt_tokens = $5,
          completion_tokens = $6,
          total_tokens = $7,
          latency_ms = $8
        where id = $1
      `,
      [
        input.id,
        input.responseText,
        JSON.stringify(sanitizePayload(input.requestPayload || {})),
        JSON.stringify(sanitizePayload(input.responsePayload || {})),
        input.promptTokens,
        input.completionTokens,
        input.totalTokens,
        input.latencyMs,
      ]
    );
  }

  async recordLlmFailed(input: LlmFailedInput): Promise<void> {
    await this.pool.query(
      `
        update llm_calls
        set status = 'failed',
            error_message = $2,
            latency_ms = $3
        where id = $1
      `,
      [input.id, input.errorMessage, input.latencyMs]
    );
  }

  async recordToolCall(input: ToolCallInput): Promise<void> {
    await this.pool.query(
      `
        insert into tool_calls (
          conversation_id,
          llm_call_id,
          tool_name,
          status,
          request_payload,
          response_payload,
          error_message,
          latency_ms
        )
        values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
      `,
      [
        input.conversationId,
        input.llmCallId,
        input.toolName,
        input.status,
        JSON.stringify(sanitizePayload(input.requestPayload || {})),
        JSON.stringify(sanitizePayload(input.responsePayload || {})),
        input.errorMessage,
        input.latencyMs,
      ]
    );
  }

  private async findOrCreateContact(
    client: PoolClient,
    chatId: string
  ): Promise<ContactRow> {
    const identity = parseChatIdentity(chatId);
    const result = await client.query<ContactRow>(
      `
        insert into contacts (chat_id, phone, lid)
        values ($1, $2, $3)
        on conflict (chat_id) do update
        set phone = coalesce(contacts.phone, excluded.phone),
            lid = coalesce(contacts.lid, excluded.lid),
            updated_at = now()
        returning id, opted_out_at
      `,
      [chatId, identity.phone, identity.lid]
    );

    return result.rows[0];
  }

  private async findOrCreateConversation(
    client: PoolClient,
    contact: ContactRow,
    chatId: string
  ): Promise<ConversationRow> {
    const current = await client.query<ConversationRow>(
      `
        select *
        from conversations
        where contact_id = $1
        for update
      `,
      [contact.id]
    );

    const conversation = current.rows[0];

    if (!conversation) {
      return this.createConversation(client, contact.id, chatId);
    }

    if (conversation.status === toDbStatus('resolved')) {
      return this.reopenConversation(client, conversation, chatId);
    }

    return conversation;
  }

  private async createConversation(
    client: PoolClient,
    contactId: string,
    chatId: string
  ): Promise<ConversationRow> {
    const result = await client.query<ConversationRow>(
      `
        insert into conversations (contact_id, chat_id, status, expires_at)
        values ($1, $2, $3, $4)
        returning *
      `,
      [
        contactId,
        chatId,
        toDbStatus('pending'),
        new Date(Date.now() + this.sessionTtlMs),
      ]
    );

    return result.rows[0];
  }

  private async reopenConversation(
    client: PoolClient,
    conversation: ConversationRow,
    chatId: string
  ): Promise<ConversationRow> {
    await client.query(
      `
        insert into conversation_transitions (
          conversation_id,
          from_status,
          to_status,
          reason
        )
        values ($1, $2, $3, 'customer_reopened')
      `,
      [conversation.id, conversation.status, toDbStatus('pending')]
    );
    const result = await client.query<ConversationRow>(
      `
        update conversations
        set status = $2,
            chat_id = $3,
            resolved_at = null,
            updated_at = now(),
            expires_at = $4
        where id = $1
        returning *
      `,
      [
        conversation.id,
        toDbStatus('pending'),
        chatId,
        new Date(Date.now() + this.sessionTtlMs),
      ]
    );

    return result.rows[0];
  }

  private async lockConversation(
    client: PoolClient,
    conversationId: number
  ): Promise<ConversationRow> {
    const result = await client.query<ConversationRow>(
      `
        select *
        from conversations
        where id = $1
        for update
      `,
      [conversationId]
    );

    return result.rows[0];
  }
}

function parseChatIdentity(chatId: string): { lid?: string; phone?: string } {
  if (chatId.endsWith('@c.us')) {
    return {
      phone: chatId.replace('@c.us', '').replace(/\D/g, ''),
    };
  }

  if (chatId.endsWith('@lid')) {
    return {
      lid: chatId,
    };
  }

  return {};
}

function toDbStatus(status: ConversationStatus): number {
  if (status === 'open') {
    return 1;
  }

  if (status === 'resolved') {
    return 2;
  }

  return 0;
}

function fromDbStatus(status: number): ConversationStatus {
  if (status === 1) {
    return 'open';
  }

  if (status === 2) {
    return 'resolved';
  }

  return 'pending';
}

function sanitizePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const blockedKeys = new Set([
    'apiKey',
    'api_key',
    'authorization',
    'cookie',
    'cookies',
    'password',
    'token',
  ]);

  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).filter(
      ([key]) => !blockedKeys.has(key.toLowerCase())
    )
  );
}

function toSession(row: ConversationRow): PersistedConversationSession {
  return {
    assignedAgent: row.assigned_agent || undefined,
    chatId: row.chat_id,
    contactId: Number(row.contact_id),
    createdAt: row.created_at.getTime(),
    expiresAt: row.expires_at?.getTime(),
    handoffReason: row.handoff_reason || undefined,
    id: Number(row.id),
    lastBotMessageAt: row.last_bot_message_at?.getTime(),
    lastCustomerMessageAt: row.last_customer_message_at?.getTime(),
    recentMessages: [],
    resolvedAt: row.resolved_at?.getTime(),
    selectedMenuOption: row.selected_menu_option || undefined,
    status: fromDbStatus(row.status),
    transitions: [],
    updatedAt: row.updated_at.getTime(),
  };
}
