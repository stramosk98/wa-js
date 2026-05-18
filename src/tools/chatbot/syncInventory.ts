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

import { loadConfig } from './config';
import { createDatabasePool } from './database';
import { createMarketplaceAdapters, syncInventoryOnce } from './inventorySync';
import { ProductInventoryRepository } from './productInventoryRepository';

async function start(): Promise<void> {
  const config = loadConfig();

  if (!config.databaseUrl) {
    throw new Error('Missing DATABASE_URL environment variable');
  }

  const pool = createDatabasePool(config.databaseUrl);
  const repository = new ProductInventoryRepository(pool);
  const adapters = createMarketplaceAdapters(config);

  try {
    await syncInventoryOnce(adapters, repository);
  } finally {
    await pool.end();
  }
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
