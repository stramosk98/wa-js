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

import type * as wpp from '../..';
import { IncomingMessagePayload } from './types';

declare global {
  interface Window {
    WPP: typeof wpp;
    waJsChatbotOnMessage: (payload: IncomingMessagePayload) => Promise<void>;
  }
}

export async function registerMessageListener(
  page: playwright.Page,
  onMessage: (payload: IncomingMessagePayload) => Promise<void>
): Promise<void> {
  await page.exposeFunction('waJsChatbotOnMessage', onMessage);

  page.on('load', async (loadedPage) => {
    await loadedPage.waitForFunction(() => window.WPP?.isReady, null, {
      timeout: 0,
    });

    await loadedPage.evaluate(() => {
      if ((window as any).__waJsChatbotRegistered) {
        return;
      }

      (window as any).__waJsChatbotRegistered = true;

      window.WPP.on('chat.new_message', async (msg) => {
        const chatId = msg.id?.fromMe
          ? msg.to?.toString()
          : msg.from?.toString();

        await window.waJsChatbotOnMessage({
          body: msg.body || msg.caption || '',
          chatId: chatId || '',
          from: msg.from?.toString() || '',
          fromMe: Boolean(msg.id?.fromMe),
          isGroupMsg: Boolean(msg.isGroupMsg),
          messageId: msg.id?.toString() || '',
          timestamp: msg.t,
          to: msg.to?.toString(),
          type: msg.type,
        });
      });
    });
  });
}

export async function sendTextMessage(
  page: playwright.Page,
  chatId: string,
  message: string
): Promise<void> {
  await page.evaluate(
    async ({ chatId, message }) => {
      await window.WPP.chat.sendTextMessage(chatId, message, {
        markIsRead: true,
        waitForAck: true,
      });
    },
    { chatId, message }
  );
}
