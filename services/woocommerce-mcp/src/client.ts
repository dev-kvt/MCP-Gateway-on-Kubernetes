export interface WooCommerceConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export class WooCommerceClient {
  private config: WooCommerceConfig;

  constructor(config?: Partial<WooCommerceConfig>) {
    this.config = {
      baseUrl: (config?.baseUrl || process.env.WOOCOMMERCE_URL || 'http://wordpress.mcp-system.svc.cluster.local').replace(/\/$/, ''),
      consumerKey: config?.consumerKey || process.env.WOOCOMMERCE_CONSUMER_KEY || '',
      consumerSecret: config?.consumerSecret || process.env.WOOCOMMERCE_CONSUMER_SECRET || '',
    };
  }

  private getAuthHeader(): string {
    const token = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');
    return `Basic ${token}`;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.config.baseUrl}/wp-json/wc/v3/${path.replace(/^\//, '')}`;
    const headers = {
      'Authorization': this.getAuthHeader(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Forwarded-Proto': 'https',
      ...(options.headers || {}),
    };

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const errorText = await res.text();
      let errorJson: any = null;
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        // keep text
      }
      const message = errorJson?.message || `WooCommerce API error ${res.status}: ${errorText}`;
      throw new Error(message);
    }

    return await res.json();
  }

  async listProducts(params: { limit?: number; page?: number; status?: string } = {}) {
    const query = new URLSearchParams();
    if (params.limit) query.set('per_page', params.limit.toString());
    if (params.page) query.set('page', params.page.toString());
    if (params.status) query.set('status', params.status);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`products${qs}`);
  }

  async createProduct(data: { name: string; regular_price: string; description?: string; categories?: Array<{ id: number } | { name: string }> }) {
    return this.request('products', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listOrders(params: { status?: string; limit?: number; page?: number } = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.limit) query.set('per_page', params.limit.toString());
    if (params.page) query.set('page', params.page.toString());
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`orders${qs}`);
  }

  async getOrder(orderId: number | string) {
    return this.request(`orders/${orderId}`);
  }

  async updateOrderStatus(orderId: number | string, status: string) {
    return this.request(`orders/${orderId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  }
}
