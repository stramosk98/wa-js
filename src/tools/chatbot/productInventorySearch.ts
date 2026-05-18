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

import { ProductInventoryRepository } from './productInventoryRepository';
import { Marketplace, ProductInventorySearchResult } from './types';

export class ProductInventorySearch {
  constructor(
    private readonly repository: ProductInventoryRepository,
    private readonly defaultLimit: number
  ) {}

  async searchProductInventory(
    query: string,
    marketplace?: Marketplace
  ): Promise<ProductInventorySearchResult> {
    return this.repository.searchProductInventory({
      limit: this.defaultLimit,
      marketplace,
      query,
    });
  }
}
