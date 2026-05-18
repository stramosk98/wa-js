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

import { Marketplace } from '../types';

export interface MarketplaceAccountSnapshot {
  displayName?: string;
  externalAccountId: string;
  marketplace: Marketplace;
}

export interface MarketplaceProductSnapshot {
  brand?: string;
  category?: string;
  descriptionSummary?: string;
  externalId: string;
  marketplace: Marketplace;
  permalink?: string;
  rawPayload: unknown;
  sku?: string;
  status?: string;
  title: string;
  variants: MarketplaceProductVariantSnapshot[];
}

export interface MarketplaceProductVariantSnapshot {
  attributes: Record<string, unknown>;
  availableQuantity: number;
  barcode?: string;
  color?: string;
  currency: string;
  externalId: string;
  inventoryPolicy?: string;
  price: number;
  rawPayload: unknown;
  regularPrice?: number;
  salePrice?: number;
  size?: string;
  sku?: string;
  title?: string;
}

export interface MarketplaceAdapter {
  fetchProducts(): Promise<MarketplaceProductSnapshot[]>;
  getAccount(): MarketplaceAccountSnapshot;
  isConfigured(): boolean;
  marketplace: Marketplace;
}
