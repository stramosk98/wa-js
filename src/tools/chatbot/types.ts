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

export interface ChatbotConfig {
  allowedChats: Set<string>;
  databaseUrl?: string;
  debounceMs: number;
  humanKeywords: string[];
  ignoreGroups: boolean;
  inventorySyncEnabled: boolean;
  inventorySyncIntervalMinutes: number;
  mercadoLivre: MercadoLivreConfig;
  menuEnabled: boolean;
  model: string;
  openAIApiKey?: string;
  optOutKeywords: string[];
  productSearchLimit: number;
  shopify: ShopifyConfig;
  sessionTtlMs: number;
  templateProductReplies: boolean;
}

export type Marketplace = 'mercado_livre' | 'shopify';

export interface MercadoLivreConfig {
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  enabled: boolean;
  refreshToken?: string;
  sellerId?: string;
}

export interface ShopifyConfig {
  adminAccessToken?: string;
  apiVersion: string;
  enabled: boolean;
  shopDomain?: string;
}

export type ConversationStatus = 'pending' | 'open' | 'resolved';

export interface ConversationTransition {
  from: ConversationStatus;
  reason: string;
  timestamp: number;
  to: ConversationStatus;
}

export interface ConversationSession {
  assignedAgent?: string;
  chatId: string;
  createdAt: number;
  handoffReason?: string;
  lastBotMessageAt?: number;
  lastCustomerMessageAt?: number;
  optOutAt?: number;
  recentMessages: IncomingMessagePayload[];
  resolvedAt?: number;
  selectedMenuOption?: string;
  status: ConversationStatus;
  transitions: ConversationTransition[];
  updatedAt: number;
}

export interface PersistedConversationSession extends ConversationSession {
  contactId: number;
  expiresAt?: number;
  id: number;
}

export interface IncomingMessagePayload {
  body: string;
  chatId: string;
  from: string;
  fromMe: boolean;
  isGroupMsg: boolean;
  messageId: string;
  timestamp?: number;
  to?: string;
  type?: string;
}

export interface PersistedIncomingMessagePayload extends IncomingMessagePayload {
  contactId: number;
  conversationId: number;
  dbMessageId: number;
}

export interface MenuOption {
  id: string;
  keywords: string[];
  label: string;
  status: ConversationStatus;
}

export interface ProductLookupResult {
  available: boolean;
  name?: string;
  note?: string;
  price?: string;
  query: string;
  sizes?: string[];
}

export interface ProductInventorySearchItem {
  availableQuantity: number;
  color?: string;
  lastSyncedAt: string;
  marketplace: Marketplace;
  price?: string;
  sku?: string;
  title: string;
  url?: string;
  variant?: string;
}

export interface ProductInventorySearchResult {
  marketplace?: Marketplace;
  query: string;
  results: ProductInventorySearchItem[];
}

export interface AIResponse {
  needsHuman: boolean;
  reason?: string;
  text: string;
}

export interface LlmStartedInput {
  conversationId: number;
  messageId?: number;
  model: string;
  promptSummary?: string;
  requestPayload?: unknown;
}

export interface LlmSucceededInput {
  completionTokens?: number;
  id: number;
  latencyMs?: number;
  promptTokens?: number;
  requestPayload?: unknown;
  responsePayload?: unknown;
  responseText?: string;
  totalTokens?: number;
}

export interface LlmFailedInput {
  errorMessage: string;
  id: number;
  latencyMs?: number;
}

export interface OutboundMessageInput {
  body: string;
  chatId: string;
  contactId: number;
  conversationId: number;
  messageType?: string;
  rawPayload?: unknown;
  senderType?: 'bot' | 'agent' | 'system';
  waMessageId?: string;
}

export interface ToolCallInput {
  conversationId: number;
  errorMessage?: string;
  latencyMs?: number;
  llmCallId?: number;
  requestPayload?: unknown;
  responsePayload?: unknown;
  status: 'started' | 'succeeded' | 'failed';
  toolName: string;
}

export interface TransitionInput {
  conversationId: number;
  metadata?: unknown;
  reason: string;
  toStatus: ConversationStatus;
}

export interface ConversationRepository {
  getConversation(
    conversationId: number
  ): Promise<PersistedConversationSession | undefined>;
  ingestInboundMessage(
    payload: IncomingMessagePayload
  ): Promise<PersistedIncomingMessagePayload | undefined>;
  markContactOptedOut(contactId: number): Promise<void>;
  recordLlmFailed(input: LlmFailedInput): Promise<void>;
  recordLlmStarted(input: LlmStartedInput): Promise<number>;
  recordLlmSucceeded(input: LlmSucceededInput): Promise<void>;
  recordOutboundMessage(input: OutboundMessageInput): Promise<void>;
  recordToolCall(input: ToolCallInput): Promise<void>;
  setSelectedMenuOption(conversationId: number, option: string): Promise<void>;
  transitionConversation(
    input: TransitionInput
  ): Promise<PersistedConversationSession>;
}
