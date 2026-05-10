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

import fetch from 'node-fetch';

import { ProductLookupResult } from './types';

export class StockClient {
  constructor(private readonly apiUrl?: string) {}

  isConfigured(): boolean {
    return Boolean(this.apiUrl);
  }

  async search(query: string): Promise<ProductLookupResult> {
    const url = new URL(this.apiUrl!);
    url.searchParams.set('q', query);

    const response = await fetch(url.toString());

    if (!response.ok) {
      return {
        available: false,
        note: `Falha ao consultar estoque: ${response.status}`,
        query,
      };
    }

    return (await response.json()) as ProductLookupResult;
  }
}
