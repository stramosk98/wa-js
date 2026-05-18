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

import * as playwright from 'playwright-chromium';

import { AIResponder } from './aiResponder';
import { ConversationState } from './conversationState';
import {
  ChatbotConfig,
  ConversationRepository,
  IncomingMessagePayload,
  MenuOption,
  PersistedConversationSession,
  PersistedIncomingMessagePayload,
} from './types';
import { sendTextMessage } from './waBridge';

const FALLBACK_MESSAGE =
  'Desculpe, não consegui responder agora. Pode tentar novamente em instantes?';
const HUMAN_HANDOFF_MESSAGE =
  'Logo você será atendido por um atendente. Enquanto isso, pode enviar mais detalhes por aqui.';
const MENU_MESSAGE = [
  'Olá! Como posso ajudar?',
  '',
  '1 - Comprar / Ver produtos',
  '2 - Consultar pedido',
  '3 - Trocas e devoluções',
  '4 - Falar com suporte',
  '5 - Falar com atendente',
  '',
  'Responda com o número da opção ou descreva sua dúvida.',
].join('\n');
const OPTOUT_MESSAGE =
  'Tudo bem, não vou continuar o atendimento automático por aqui.';
const MENU_SENT_OPTION = 'menu_sent';

const MENU_OPTIONS: MenuOption[] = [
  {
    id: 'products',
    keywords: ['1', 'comprar', 'produto', 'produtos', 'ver produtos'],
    label: 'Comprar / Ver produtos',
    status: 'pending',
  },
  {
    id: 'order',
    keywords: ['2', 'pedido', 'consultar pedido'],
    label: 'Consultar pedido',
    status: 'pending',
  },
  {
    id: 'returns',
    keywords: ['3', 'troca', 'trocas', 'devolucao', 'devolucoes'],
    label: 'Trocas e devoluções',
    status: 'pending',
  },
  {
    id: 'support',
    keywords: ['4', 'suporte', 'duvida', 'ajuda'],
    label: 'Falar com suporte',
    status: 'pending',
  },
  {
    id: 'human',
    keywords: ['5', 'humano', 'atendente'],
    label: 'Falar com atendente',
    status: 'open',
  },
];

export class MessageRouter {
  private readonly state: ConversationState;

  constructor(
    private readonly page: playwright.Page,
    private readonly config: ChatbotConfig,
    private readonly responder: AIResponder,
    private readonly repository: ConversationRepository
  ) {
    this.state = new ConversationState(config.debounceMs, config.sessionTtlMs);
  }

  async route(payload: IncomingMessagePayload): Promise<void> {
    if (!this.shouldHandle(payload)) {
      return;
    }

    const persisted = await this.repository.ingestInboundMessage(payload);

    if (!persisted) {
      return;
    }

    this.state.enqueue(persisted, (messages) => {
      this.respond(messages).catch((error) => {
        console.error('Failed to respond to chat:', messages[0].chatId, error);
      });
    });
  }

  private shouldHandle(payload: IncomingMessagePayload): boolean {
    if (!payload.messageId || !payload.chatId) {
      return false;
    }

    if (payload.fromMe) {
      return false;
    }

    if (this.config.ignoreGroups && payload.isGroupMsg) {
      return false;
    }

    if (
      this.config.allowedChats.size &&
      !this.config.allowedChats.has(payload.chatId)
    ) {
      return false;
    }

    return payload.type === 'chat' && Boolean(payload.body.trim());
  }

  private async respond(
    messages: PersistedIncomingMessagePayload[]
  ): Promise<void> {
    const chatId = messages[0].chatId;

    if (this.state.isActive(chatId)) {
      return;
    }

    this.state.setActive(chatId, true);

    try {
      const session = await this.repository.getConversation(
        messages[0].conversationId
      );

      if (!session) {
        return;
      }

      await this.respondByState(session, messages);
    } catch (error) {
      console.error('Chatbot response error:', error);
      await this.sendAndTrack(messages[0], FALLBACK_MESSAGE);
    } finally {
      this.state.setActive(chatId, false);
      const queuedMessages = this.state.consumeQueued(chatId);

      if (queuedMessages.length) {
        await this.respond(queuedMessages);
      }
    }
  }

  private async respondByState(
    session: PersistedConversationSession,
    messages: PersistedIncomingMessagePayload[]
  ): Promise<void> {
    const content = this.normalizeContent(messages);

    if (session.status === 'open') {
      return;
    }

    if (this.matchesAny(content, this.config.optOutKeywords)) {
      await this.repository.markContactOptedOut(session.contactId);
      await this.sendAndTrack(session, OPTOUT_MESSAGE);
      return;
    }

    if (this.matchesAny(content, this.config.humanKeywords)) {
      await this.transferToHuman(session, 'customer_requested_human');
      return;
    }

    if (!session.selectedMenuOption) {
      if (this.config.menuEnabled) {
        await this.repository.setSelectedMenuOption(
          session.id,
          MENU_SENT_OPTION
        );
        await this.sendAndTrack(session, MENU_MESSAGE);
        return;
      }

      await this.repository.setSelectedMenuOption(session.id, 'menu_disabled');
      session.selectedMenuOption = 'menu_disabled';
    }

    if (session.selectedMenuOption === MENU_SENT_OPTION) {
      await this.handleMenuChoice(session, messages, content);
      return;
    }

    await this.handleLlmSupport(session, messages);
  }

  private async handleMenuChoice(
    session: PersistedConversationSession,
    messages: PersistedIncomingMessagePayload[],
    content: string
  ): Promise<void> {
    if (content === 'menu' || content === 'voltar') {
      await this.sendAndTrack(session, MENU_MESSAGE);
      return;
    }

    const option = this.findMenuOption(content);

    if (option?.status === 'open') {
      await this.repository.setSelectedMenuOption(session.id, option.id);
      await this.transferToHuman(session, 'menu_human_option');
      return;
    }

    if (option?.status === 'pending' || this.looksLikeQuestion(content)) {
      await this.repository.setSelectedMenuOption(
        session.id,
        option?.id || 'direct_question'
      );
      await this.handleLlmSupport(
        {
          ...session,
          selectedMenuOption: option?.id || 'direct_question',
        },
        messages
      );
      return;
    }

    await this.sendAndTrack(
      session,
      `Não entendi a opção. Por favor, escolha uma das opções abaixo:\n\n${MENU_MESSAGE}`
    );
  }

  private async handleLlmSupport(
    session: PersistedConversationSession,
    messages: PersistedIncomingMessagePayload[]
  ): Promise<void> {
    try {
      const response = await this.responder.respond(
        messages,
        this.config.model,
        session
      );

      if (response.needsHuman) {
        await this.transferToHuman(
          session,
          response.reason || 'llm_requested_human'
        );
        return;
      }

      await this.sendAndTrack(session, response.text || FALLBACK_MESSAGE);
    } catch (error) {
      console.error('Chatbot LLM error:', error);
      await this.transferToHuman(session, 'llm_error');
    }
  }

  private findMenuOption(content: string): MenuOption | undefined {
    return MENU_OPTIONS.find((option) =>
      option.keywords.some((keyword) => content === keyword)
    );
  }

  private looksLikeQuestion(content: string): boolean {
    return content.includes('?') || content.split(/\s+/).length > 3;
  }

  private matchesAny(content: string, keywords: string[]): boolean {
    return keywords.some((keyword) => content.includes(keyword));
  }

  private normalizeContent(messages: IncomingMessagePayload[]): string {
    return messages
      .map((message) => message.body.trim().toLowerCase())
      .filter(Boolean)
      .join(' ');
  }

  private async sendAndTrack(
    target: PersistedConversationSession | PersistedIncomingMessagePayload,
    message: string
  ): Promise<void> {
    await sendTextMessage(this.page, target.chatId, message);
    await this.repository.recordOutboundMessage({
      body: message,
      chatId: target.chatId,
      contactId: target.contactId,
      conversationId:
        'conversationId' in target ? target.conversationId : target.id,
    });
  }

  private async transferToHuman(
    session: PersistedConversationSession,
    reason: string
  ): Promise<void> {
    const updated = await this.repository.transitionConversation({
      conversationId: session.id,
      reason,
      toStatus: 'open',
    });
    await this.sendAndTrack(updated, HUMAN_HANDOFF_MESSAGE);
  }
}
