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

import { MercadoLivreAdapter } from './marketplaces/mercadoLivreAdapter';
import { ShopifyAdapter } from './marketplaces/shopifyAdapter';
import { MarketplaceAdapter } from './marketplaces/types';
import { ProductInventoryRepository } from './productInventoryRepository';
import { ChatbotConfig } from './types';

const MINUTE_MS = 60 * 1000;

export function createMarketplaceAdapters(
  config: ChatbotConfig
): MarketplaceAdapter[] {
  return [
    new MercadoLivreAdapter(config.mercadoLivre),
    new ShopifyAdapter(config.shopify),
  ];
}

export async function syncInventoryOnce(
  adapters: MarketplaceAdapter[],
  repository: ProductInventoryRepository
): Promise<void> {
  for (const adapter of adapters) {
    await syncAdapter(adapter, repository);
  }
}

export function startBackgroundInventorySync(
  config: ChatbotConfig,
  repository: ProductInventoryRepository
): NodeJS.Timeout | undefined {
  if (!config.inventorySyncEnabled) {
    return undefined;
  }

  const adapters = createMarketplaceAdapters(config);
  const intervalMs = config.inventorySyncIntervalMinutes * MINUTE_MS;
  let isRunning = false;

  const run = async () => {
    if (isRunning) {
      console.log('Skipping inventory sync: previous run is still active');
      return;
    }

    isRunning = true;

    try {
      await syncInventoryOnce(adapters, repository);
    } catch (error) {
      console.error('Background inventory sync failed:', error);
    } finally {
      isRunning = false;
    }
  };

  run().catch((error) => {
    console.error('Background inventory sync failed:', error);
  });

  return setInterval(run, intervalMs);
}

async function syncAdapter(
  adapter: MarketplaceAdapter,
  repository: ProductInventoryRepository
): Promise<void> {
  if (!adapter.isConfigured()) {
    console.log(`Skipping ${adapter.marketplace}: not configured`);
    return;
  }

  const syncRunId = await repository.beginSync(adapter.marketplace);

  try {
    const products = await adapter.fetchProducts();
    const itemsUpserted = await repository.upsertMarketplaceSnapshot(
      adapter.getAccount(),
      products
    );

    await repository.finishSync(syncRunId, {
      itemsSeen: products.length,
      itemsUpserted,
    });
    console.log(`Synced ${itemsUpserted} ${adapter.marketplace} products`);
  } catch (error) {
    await repository.failSync(syncRunId, error);
    throw error;
  }
}
