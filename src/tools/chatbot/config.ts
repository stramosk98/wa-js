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

import { ChatbotConfig } from './types';

const DEFAULT_HUMAN_KEYWORDS = [
  'atendente',
  'humano',
  'reclamacao',
  'reclamação',
  'cancelamento',
];
const DEFAULT_OPTOUT_KEYWORDS = ['parar', 'sair'];

function parseAllowedChats(value?: string): Set<string> {
  return new Set(
    (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  const items = (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return items.length ? items : fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): ChatbotConfig {
  return {
    allowedChats: parseAllowedChats(process.env['CHATBOT_ALLOWED_CHATS']),
    debounceMs: parseNumber(process.env['CHATBOT_DEBOUNCE_MS'], 1500),
    humanKeywords: parseList(
      process.env['CHATBOT_HUMAN_KEYWORDS'],
      DEFAULT_HUMAN_KEYWORDS
    ),
    ignoreGroups: process.env['CHATBOT_IGNORE_GROUPS'] !== 'false',
    menuEnabled: process.env['CHATBOT_MENU_ENABLED'] !== 'false',
    model: process.env['OPENAI_MODEL'] || 'gpt-4.1-mini',
    openAIApiKey: process.env['OPENAI_API_KEY'],
    optOutKeywords: parseList(
      process.env['CHATBOT_OPTOUT_KEYWORDS'],
      DEFAULT_OPTOUT_KEYWORDS
    ),
    sessionTtlMs: parseNumber(
      process.env['CHATBOT_SESSION_TTL_MS'],
      24 * 60 * 60 * 1000
    ),
    stockApiUrl: process.env['STOCK_API_URL'],
  };
}
