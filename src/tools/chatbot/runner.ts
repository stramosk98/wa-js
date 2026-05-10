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

import 'dotenv/config';

import { getPage } from '../browser';
import { AIResponder } from './aiResponder';
import { loadConfig } from './config';
import { MessageRouter } from './messageRouter';
import { StockClient } from './stockClient';
import { registerMessageListener } from './waBridge';

async function start() {
  const config = loadConfig();

  if (!config.openAIApiKey) {
    throw new Error('Missing OPENAI_API_KEY environment variable');
  }

  const args = process.argv.slice(2);
  const { page } = await getPage({
    headless: false,
    viewport: null,
    args,
  });

  const stockClient = new StockClient(config.stockApiUrl);
  const responder = new AIResponder(config, stockClient);
  const router = new MessageRouter(page, config, responder);

  await registerMessageListener(page, async (payload) => {
    router.route(payload);
  });

  console.log('WA-JS chatbot started. Waiting for WhatsApp messages...');
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
