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
  debounceMs: number;
  humanKeywords: string[];
  ignoreGroups: boolean;
  menuEnabled: boolean;
  model: string;
  openAIApiKey?: string;
  optOutKeywords: string[];
  sessionTtlMs: number;
  stockApiUrl?: string;
}

export type ConversationStatus =
  | 'new'
  | 'waiting_menu_choice'
  | 'llm_support'
  | 'waiting_human'
  | 'human_in_progress'
  | 'resolved'
  | 'opted_out';

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

export interface AIResponse {
  needsHuman: boolean;
  reason?: string;
  text: string;
}

export interface ConversationRepository {
  get(chatId: string): Promise<ConversationSession | undefined>;
  save(session: ConversationSession): Promise<void>;
}
