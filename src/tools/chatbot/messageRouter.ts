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
  ConversationSession,
  IncomingMessagePayload,
  MenuOption,
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

const MENU_OPTIONS: MenuOption[] = [
  {
    id: 'products',
    keywords: ['1', 'comprar', 'produto', 'produtos', 'ver produtos'],
    label: 'Comprar / Ver produtos',
    status: 'llm_support',
  },
  {
    id: 'order',
    keywords: ['2', 'pedido', 'consultar pedido'],
    label: 'Consultar pedido',
    status: 'llm_support',
  },
  {
    id: 'returns',
    keywords: ['3', 'troca', 'trocas', 'devolucao', 'devolucoes'],
    label: 'Trocas e devoluções',
    status: 'llm_support',
  },
  {
    id: 'support',
    keywords: ['4', 'suporte', 'duvida', 'ajuda'],
    label: 'Falar com suporte',
    status: 'llm_support',
  },
  {
    id: 'human',
    keywords: ['5', 'humano', 'atendente'],
    label: 'Falar com atendente',
    status: 'waiting_human',
  },
];

export class MessageRouter {
  private readonly state: ConversationState;

  constructor(
    private readonly page: playwright.Page,
    private readonly config: ChatbotConfig,
    private readonly responder: AIResponder
  ) {
    this.state = new ConversationState(config.debounceMs, config.sessionTtlMs);
  }

  route(payload: IncomingMessagePayload): void {
    if (!this.shouldHandle(payload)) {
      return;
    }

    this.state.markProcessed(payload.messageId);
    this.state.enqueue(payload, (messages) => {
      this.respond(messages).catch((error) => {
        console.error('Failed to respond to chat:', messages[0].chatId, error);
      });
    });
  }

  private shouldHandle(payload: IncomingMessagePayload): boolean {
    if (!payload.messageId || !payload.chatId) {
      return false;
    }

    if (this.state.isProcessed(payload.messageId) || payload.fromMe) {
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

  private async respond(messages: IncomingMessagePayload[]): Promise<void> {
    const chatId = messages[0].chatId;

    if (this.state.isActive(chatId)) {
      return;
    }

    this.state.setActive(chatId, true);

    try {
      this.state.appendMessages(chatId, messages);

      const session = this.state.getOrCreateSession(chatId);
      await this.respondByState(session, messages);
    } catch (error) {
      console.error('Chatbot response error:', error);
      await this.sendAndTrack(chatId, FALLBACK_MESSAGE);
    } finally {
      this.state.setActive(chatId, false);
      const queuedMessages = this.state.consumeQueued(chatId);

      if (queuedMessages.length) {
        await this.respond(queuedMessages);
      }
    }
  }

  private async respondByState(
    session: ConversationSession,
    messages: IncomingMessagePayload[]
  ): Promise<void> {
    const content = this.normalizeContent(messages);

    if (this.matchesAny(content, this.config.optOutKeywords)) {
      this.state.markOptOut(session.chatId);
      await this.sendAndTrack(session.chatId, OPTOUT_MESSAGE);
      return;
    }

    if (this.matchesAny(content, this.config.humanKeywords)) {
      await this.transferToHuman(session.chatId, 'customer_requested_human');
      return;
    }

    if (session.status === 'opted_out') {
      return;
    }

    if (
      session.status === 'waiting_human' ||
      session.status === 'human_in_progress'
    ) {
      return;
    }

    if (session.status === 'resolved' && !this.state.isExpired(session)) {
      return;
    }

    if (session.status === 'resolved' && this.state.isExpired(session)) {
      this.state.setStatus(session.chatId, 'new', 'session_expired');
    }

    if (session.status === 'new') {
      if (this.config.menuEnabled) {
        this.state.setStatus(
          session.chatId,
          'waiting_menu_choice',
          'menu_sent'
        );
        await this.sendAndTrack(session.chatId, MENU_MESSAGE);
        return;
      }

      this.state.setStatus(session.chatId, 'llm_support', 'menu_disabled');
    }

    if (session.status === 'waiting_menu_choice') {
      await this.handleMenuChoice(session, messages, content);
      return;
    }

    if (session.status === 'llm_support') {
      await this.handleLlmSupport(session, messages);
    }
  }

  private async handleMenuChoice(
    session: ConversationSession,
    messages: IncomingMessagePayload[],
    content: string
  ): Promise<void> {
    if (content === 'menu' || content === 'voltar') {
      await this.sendAndTrack(session.chatId, MENU_MESSAGE);
      return;
    }

    const option = this.findMenuOption(content);

    if (option?.status === 'waiting_human') {
      this.state.setSelectedMenuOption(session.chatId, option.id);
      await this.transferToHuman(session.chatId, 'menu_human_option');
      return;
    }

    if (option?.status === 'llm_support' || this.looksLikeQuestion(content)) {
      this.state.setSelectedMenuOption(
        session.chatId,
        option?.id || 'direct_question'
      );
      this.state.setStatus(session.chatId, 'llm_support', 'menu_to_llm');
      await this.handleLlmSupport(session, messages);
      return;
    }

    await this.sendAndTrack(
      session.chatId,
      `Não entendi a opção. Por favor, escolha uma das opções abaixo:\n\n${MENU_MESSAGE}`
    );
  }

  private async handleLlmSupport(
    session: ConversationSession,
    messages: IncomingMessagePayload[]
  ): Promise<void> {
    try {
      const response = await this.responder.respond(
        messages,
        this.config.model
      );

      if (response.needsHuman) {
        await this.transferToHuman(
          session.chatId,
          response.reason || 'llm_requested_human'
        );
        return;
      }

      await this.sendAndTrack(
        session.chatId,
        response.text || FALLBACK_MESSAGE
      );
    } catch (error) {
      console.error('Chatbot LLM error:', error);
      await this.transferToHuman(session.chatId, 'llm_error');
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

  private async sendAndTrack(chatId: string, message: string): Promise<void> {
    await sendTextMessage(this.page, chatId, message);
    this.state.markBotMessage(chatId);
  }

  private async transferToHuman(chatId: string, reason: string): Promise<void> {
    this.state.markHumanHandoff(chatId, reason);
    await this.sendAndTrack(chatId, HUMAN_HANDOFF_MESSAGE);
  }
}
