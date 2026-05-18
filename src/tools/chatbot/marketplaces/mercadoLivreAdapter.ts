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

import { MercadoLivreConfig } from '../types';
import {
  MarketplaceAccountSnapshot,
  MarketplaceAdapter,
  MarketplaceProductSnapshot,
  MarketplaceProductVariantSnapshot,
} from './types';

const API_BASE_URL = 'https://api.mercadolibre.com';
const PAGE_LIMIT = 50;

interface MercadoLivreItemsSearchResponse {
  paging?: {
    offset: number;
    total: number;
  };
  results: string[];
}

interface MercadoLivreAttribute {
  id?: string;
  name?: string;
  value_name?: string;
}

interface MercadoLivreVariation {
  attribute_combinations?: MercadoLivreAttribute[];
  attributes?: MercadoLivreAttribute[];
  available_quantity?: number;
  id: number;
  price?: number;
  seller_custom_field?: string;
}

interface MercadoLivreItem {
  attributes?: MercadoLivreAttribute[];
  available_quantity?: number;
  base_price?: number;
  category_id?: string;
  currency_id?: string;
  id: string;
  permalink?: string;
  price?: number;
  seller_custom_field?: string;
  status?: string;
  title: string;
  variations?: MercadoLivreVariation[];
}

interface MercadoLivreTokenResponse {
  access_token?: string;
}

export class MercadoLivreAdapter implements MarketplaceAdapter {
  readonly marketplace = 'mercado_livre' as const;
  private accessToken?: string;

  constructor(private readonly config: MercadoLivreConfig) {
    this.accessToken = config.accessToken;
  }

  getAccount(): MarketplaceAccountSnapshot {
    return {
      displayName: `Mercado Livre ${this.config.sellerId}`,
      externalAccountId: this.config.sellerId || '',
      marketplace: this.marketplace,
    };
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.enabled && this.config.sellerId && this.hasAuth()
    );
  }

  async fetchProducts(): Promise<MarketplaceProductSnapshot[]> {
    const itemIds = await this.fetchItemIds();
    const products: MarketplaceProductSnapshot[] = [];

    for (const itemId of itemIds) {
      const item = await this.fetchItem(itemId);
      products.push(toProductSnapshot(item));
    }

    return products;
  }

  private async fetchItem(itemId: string): Promise<MercadoLivreItem> {
    return this.fetchJson<MercadoLivreItem>(`/items/${itemId}`);
  }

  private async fetchItemIds(): Promise<string[]> {
    const itemIds: string[] = [];
    let offset = 0;
    let total = 0;

    do {
      const response = await this.fetchJson<MercadoLivreItemsSearchResponse>(
        `/users/${this.config.sellerId}/items/search?limit=${PAGE_LIMIT}&offset=${offset}`
      );

      itemIds.push(...response.results);
      total = response.paging?.total || itemIds.length;
      offset += PAGE_LIMIT;
    } while (itemIds.length < total);

    return itemIds;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Mercado Livre API failed: ${response.status}`);
    }

    return (await response.json()) as T;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    const response = await fetch(`${API_BASE_URL}/oauth/token`, {
      body: new URLSearchParams({
        client_id: this.config.clientId || '',
        client_secret: this.config.clientSecret || '',
        grant_type: 'refresh_token',
        refresh_token: this.config.refreshToken || '',
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Mercado Livre token refresh failed: ${response.status}`);
    }

    const token = (await response.json()) as MercadoLivreTokenResponse;

    if (!token.access_token) {
      throw new Error(
        'Mercado Livre token refresh did not return access_token'
      );
    }

    this.accessToken = token.access_token;

    return token.access_token;
  }

  private hasAuth(): boolean {
    return Boolean(
      this.accessToken ||
      (this.config.clientId &&
        this.config.clientSecret &&
        this.config.refreshToken)
    );
  }
}

function findAttributeValue(
  attributes: MercadoLivreAttribute[] | undefined,
  ids: string[]
): string | undefined {
  return attributes?.find((attribute) => ids.includes(attribute.id || ''))
    ?.value_name;
}

function findSku(
  item: MercadoLivreItem,
  variation?: MercadoLivreVariation
): string | undefined {
  return (
    variation?.seller_custom_field ||
    findAttributeValue(variation?.attributes, ['SELLER_SKU']) ||
    item.seller_custom_field ||
    findAttributeValue(item.attributes, ['SELLER_SKU'])
  );
}

function toDefaultVariant(
  item: MercadoLivreItem
): MarketplaceProductVariantSnapshot {
  return {
    attributes: Object.fromEntries(
      (item.attributes || []).map((attribute) => [
        attribute.id || attribute.name || '',
        attribute.value_name,
      ])
    ),
    availableQuantity: item.available_quantity || 0,
    color: findAttributeValue(item.attributes, ['COLOR']),
    currency: item.currency_id || 'BRL',
    externalId: item.id,
    price: Number(item.price || 0),
    rawPayload: item,
    regularPrice: item.base_price,
    sku: findSku(item),
    title: item.title,
  };
}

function toProductSnapshot(item: MercadoLivreItem): MarketplaceProductSnapshot {
  const brand = findAttributeValue(item.attributes, ['BRAND']);
  const variants = item.variations?.length
    ? item.variations.map((variation) => toVariantSnapshot(item, variation))
    : [toDefaultVariant(item)];

  return {
    brand,
    category: item.category_id,
    externalId: item.id,
    marketplace: 'mercado_livre',
    permalink: item.permalink,
    rawPayload: item,
    sku: findSku(item),
    status: item.status,
    title: item.title,
    variants,
  };
}

function toVariantSnapshot(
  item: MercadoLivreItem,
  variation: MercadoLivreVariation
): MarketplaceProductVariantSnapshot {
  const attributes = [
    ...(variation.attribute_combinations || []),
    ...(variation.attributes || []),
  ];

  return {
    attributes: Object.fromEntries(
      attributes.map((attribute) => [
        attribute.id || attribute.name || '',
        attribute.value_name,
      ])
    ),
    availableQuantity: variation.available_quantity || 0,
    color: findAttributeValue(attributes, ['COLOR']),
    currency: item.currency_id || 'BRL',
    externalId: String(variation.id),
    price: Number(variation.price || item.price || 0),
    rawPayload: variation,
    regularPrice: item.base_price,
    size: findAttributeValue(attributes, ['SIZE', 'MANUFACTURER_SIZE']),
    sku: findSku(item, variation),
    title: attributes
      .map((attribute) => attribute.value_name)
      .filter(Boolean)
      .join(' / '),
  };
}
