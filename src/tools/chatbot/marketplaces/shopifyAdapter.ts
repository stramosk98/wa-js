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

import { ShopifyConfig } from '../types';
import {
  MarketplaceAccountSnapshot,
  MarketplaceAdapter,
  MarketplaceProductSnapshot,
  MarketplaceProductVariantSnapshot,
} from './types';

const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          vendor
          productType
          status
          onlineStoreUrl
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                inventoryQuantity
                inventoryPolicy
                selectedOptions {
                  name
                  value
                }
                inventoryItem {
                  id
                  tracked
                }
              }
            }
          }
        }
      }
    }
  }
`;
const SHOP_QUERY = `
  query Shop {
    shop {
      currencyCode
      name
    }
  }
`;

interface ShopifyGraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface ShopifyPageInfo {
  endCursor?: string;
  hasNextPage: boolean;
}

interface ShopifySelectedOption {
  name: string;
  value: string;
}

interface ShopifyVariant {
  barcode?: string;
  compareAtPrice?: string;
  id: string;
  inventoryItem?: {
    id: string;
    tracked: boolean;
  };
  inventoryPolicy?: string;
  inventoryQuantity?: number;
  price: string;
  selectedOptions: ShopifySelectedOption[];
  sku?: string;
  title: string;
}

interface ShopifyProduct {
  handle?: string;
  id: string;
  onlineStoreUrl?: string;
  productType?: string;
  status?: string;
  title: string;
  variants: {
    edges: Array<{ node: ShopifyVariant }>;
  };
  vendor?: string;
}

interface ShopifyProductsData {
  products: {
    edges: Array<{ node: ShopifyProduct }>;
    pageInfo: ShopifyPageInfo;
  };
}

interface ShopifyShopData {
  shop: {
    currencyCode: string;
    name: string;
  };
}

export class ShopifyAdapter implements MarketplaceAdapter {
  readonly marketplace = 'shopify' as const;
  private currency = 'BRL';
  private shopName?: string;

  constructor(private readonly config: ShopifyConfig) {}

  getAccount(): MarketplaceAccountSnapshot {
    return {
      displayName: this.shopName || this.config.shopDomain,
      externalAccountId: this.config.shopDomain || '',
      marketplace: this.marketplace,
    };
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.enabled &&
      this.config.shopDomain &&
      this.config.adminAccessToken
    );
  }

  async fetchProducts(): Promise<MarketplaceProductSnapshot[]> {
    await this.fetchShopMetadata();

    const products: MarketplaceProductSnapshot[] = [];
    let cursor: string | undefined;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await this.graphql<ShopifyProductsData>(PRODUCTS_QUERY, {
        cursor,
      });

      products.push(
        ...response.products.edges.map((edge) =>
          this.toProductSnapshot(edge.node)
        )
      );
      hasNextPage = response.products.pageInfo.hasNextPage;
      cursor = response.products.pageInfo.endCursor;
    }

    return products;
  }

  private async fetchShopMetadata(): Promise<void> {
    const response = await this.graphql<ShopifyShopData>(SHOP_QUERY, {});

    this.currency = response.shop.currencyCode;
    this.shopName = response.shop.name;
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(
      `https://${this.config.shopDomain}/admin/api/${this.config.apiVersion}/graphql.json`,
      {
        body: JSON.stringify({ query, variables }),
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.config.adminAccessToken || '',
        },
        method: 'POST',
      }
    );

    if (!response.ok) {
      throw new Error(`Shopify Admin API failed: ${response.status}`);
    }

    const body = (await response.json()) as ShopifyGraphQlResponse<T>;

    if (body.errors?.length) {
      throw new Error(`Shopify Admin API error: ${body.errors[0].message}`);
    }

    if (!body.data) {
      throw new Error('Shopify Admin API response did not include data');
    }

    return body.data;
  }

  private toProductSnapshot(
    product: ShopifyProduct
  ): MarketplaceProductSnapshot {
    return {
      brand: product.vendor,
      category: product.productType,
      externalId: product.id,
      marketplace: 'shopify',
      permalink: product.onlineStoreUrl || this.buildProductUrl(product.handle),
      rawPayload: product,
      status: product.status,
      title: product.title,
      variants: product.variants.edges.map((edge) =>
        this.toVariantSnapshot(edge.node)
      ),
    };
  }

  private toVariantSnapshot(
    variant: ShopifyVariant
  ): MarketplaceProductVariantSnapshot {
    const attributes = Object.fromEntries(
      variant.selectedOptions.map((option) => [option.name, option.value])
    );

    return {
      attributes,
      availableQuantity: variant.inventoryQuantity || 0,
      barcode: variant.barcode,
      color: findOption(variant.selectedOptions, ['color', 'cor']),
      currency: this.currency,
      externalId: variant.id,
      inventoryPolicy: variant.inventoryPolicy,
      price: Number(variant.price || 0),
      rawPayload: variant,
      regularPrice: variant.compareAtPrice
        ? Number(variant.compareAtPrice)
        : undefined,
      size: findOption(variant.selectedOptions, ['size', 'tamanho']),
      sku: variant.sku,
      title: variant.title,
    };
  }

  private buildProductUrl(handle?: string): string | undefined {
    if (!handle || !this.config.shopDomain) {
      return undefined;
    }

    return `https://${this.config.shopDomain}/products/${handle}`;
  }
}

function findOption(
  options: ShopifySelectedOption[],
  names: string[]
): string | undefined {
  return options.find((option) => names.includes(option.name.toLowerCase()))
    ?.value;
}
