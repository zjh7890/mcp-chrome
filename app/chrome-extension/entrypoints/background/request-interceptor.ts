import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import { CustomToolsConfig, WebRequestListenerConfig } from './types/custom-tools';

/**
 * 请求拦截器管理器
 * 用于拦截和处理 HTTP 请求，提取所需的请求头信息
 */
export class RequestInterceptorManager {
  private activeListeners: Map<
    string,
    {
      onBeforeRequest?: (details: chrome.webRequest.WebRequestBodyDetails) => void;
      onBeforeSendHeaders?: (details: chrome.webRequest.WebRequestHeadersDetails) => void;
      onHeadersReceived?: (details: chrome.webRequest.WebResponseHeadersDetails) => void;
      onCompleted?: (details: chrome.webRequest.WebResponseCacheDetails) => void;
    }
  > = new Map();
  private isInitialized = false;

  /**
   * 初始化请求拦截器
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // 加载自定义工具配置
      await this.loadAndSetupListeners();
      this.isInitialized = true;
      console.log('RequestInterceptorManager: Initialized successfully');
    } catch (error) {
      console.error('RequestInterceptorManager: Failed to initialize:', error);
    }
  }

  /**
   * 重新加载配置并更新监听器
   */
  public async reloadConfig(): Promise<void> {
    this.clearAllListeners();
    await this.loadAndSetupListeners();
  }

  /**
   * 加载配置并设置监听器
   */
  private async loadAndSetupListeners(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['custom_tools_config']);
      const config: CustomToolsConfig = result.custom_tools_config || { customTools: [] };

      // 为每个启用了 webRequest 监听的配置设置监听器
      if (config.webRequestListeners) {
        for (const listener of config.webRequestListeners) {
          if (listener.enabled) {
            await this.setupListenerForTool(listener);
          }
        }
      }
    } catch (error) {
      console.error('RequestInterceptorManager: Failed to load config:', error);
    }
  }

  /**
   * 为特定配置设置 webRequest 监听器
   */
  private async setupListenerForTool(listener: WebRequestListenerConfig): Promise<void> {
    const { urlPattern, field, storageKey } = listener;

    // 如果已经有相同的监听器，先移除
    if (this.activeListeners.has(storageKey)) {
      this.removeListener(storageKey);
    }

    try {
      const parsed = this.parseField(field);
      const listeners: {
        onBeforeRequest?: (details: chrome.webRequest.WebRequestBodyDetails) => void;
        onBeforeSendHeaders?: (details: chrome.webRequest.WebRequestHeadersDetails) => void;
        onHeadersReceived?: (details: chrome.webRequest.WebResponseHeadersDetails) => void;
        onCompleted?: (details: chrome.webRequest.WebResponseCacheDetails) => void;
      } = {};

      // 根据字段类型在最合适的阶段注册监听
      switch (parsed.kind) {
        case 'request.header': {
          const fn = (details: chrome.webRequest.WebRequestHeadersDetails) => {
            const value = this.extractFromRequestHeader(details, parsed.name);
            if (value !== undefined) this.storeValue(storageKey, value, field);
          };
          chrome.webRequest.onBeforeSendHeaders.addListener(fn, { urls: [urlPattern] }, [
            'requestHeaders',
          ]);
          listeners.onBeforeSendHeaders = fn;
          break;
        }
        case 'request.body': {
          const fn = (details: chrome.webRequest.WebRequestBodyDetails) => {
            const value = this.extractFromRequestBody(details, parsed.name);
            if (value !== undefined) this.storeValue(storageKey, value, field);
          };
          chrome.webRequest.onBeforeRequest.addListener(fn, { urls: [urlPattern] }, [
            'requestBody',
          ]);
          listeners.onBeforeRequest = fn;
          break;
        }
        case 'response.header': {
          const fn = (details: chrome.webRequest.WebResponseHeadersDetails) => {
            const value = this.extractFromResponseHeader(details, parsed.name);
            if (value !== undefined) this.storeValue(storageKey, value, field);
          };
          chrome.webRequest.onHeadersReceived.addListener(fn, { urls: [urlPattern] }, [
            'responseHeaders',
          ]);
          listeners.onHeadersReceived = fn;
          break;
        }
        case 'request.method': {
          const fn = (details: chrome.webRequest.WebRequestBodyDetails) => {
            const value = details.method;
            if (value) this.storeValue(storageKey, value, field);
          };
          chrome.webRequest.onBeforeRequest.addListener(fn, { urls: [urlPattern] });
          listeners.onBeforeRequest = fn;
          break;
        }
        case 'request.url': {
          const fn = (details: chrome.webRequest.WebRequestBodyDetails) => {
            const value = details.url;
            if (value) this.storeValue(storageKey, value, field);
          };
          chrome.webRequest.onBeforeRequest.addListener(fn, { urls: [urlPattern] });
          listeners.onBeforeRequest = fn;
          break;
        }
        case 'request.query': {
          const fn = (details: chrome.webRequest.WebRequestBodyDetails) => {
            const url = details.url;
            try {
              const u = new URL(url);
              const value = u.searchParams.get(parsed.name || '');
              if (value !== null) this.storeValue(storageKey, value, field);
            } catch (e) {
              // 忽略非法 URL
              return;
            }
          };
          chrome.webRequest.onBeforeRequest.addListener(fn, { urls: [urlPattern] });
          listeners.onBeforeRequest = fn;
          break;
        }
        case 'response.statusCode':
        case 'response.statusLine':
        case 'response.mimeType': {
          const fn = (details: chrome.webRequest.WebResponseHeadersDetails) => {
            let value: string | undefined;
            if (parsed.kind === 'response.statusCode') value = String(details.statusCode);
            else if (parsed.kind === 'response.statusLine') value = details.statusLine;
            else if (parsed.kind === 'response.mimeType') {
              const ct = details.responseHeaders?.find(
                (h) => h.name.toLowerCase() === 'content-type',
              )?.value;
              value = ct || '';
            }
            if (value !== undefined && value !== '') this.storeValue(storageKey, value, field);
          };
          chrome.webRequest.onHeadersReceived.addListener(fn, { urls: [urlPattern] }, [
            'responseHeaders',
          ]);
          listeners.onHeadersReceived = fn;
          break;
        }
        case 'response.fromCache':
        case 'response.ip': {
          const fn = (details: chrome.webRequest.WebResponseCacheDetails) => {
            if (parsed.kind === 'response.fromCache') {
              this.storeValue(storageKey, String(details.fromCache === true), field);
            } else if (parsed.kind === 'response.ip') {
              const ip = (details as any).ip || (details as any).ipAddress;
              if (ip) this.storeValue(storageKey, String(ip), field);
            }
          };
          chrome.webRequest.onCompleted.addListener(fn, { urls: [urlPattern] });
          listeners.onCompleted = fn;
          break;
        }
        default: {
          throw new Error(`Unsupported field: ${field}`);
        }
      }

      // 保存监听器引用（用于移除）
      this.activeListeners.set(storageKey, listeners);

      console.log(
        `RequestInterceptorManager: Setup listener for ${storageKey} on ${urlPattern} (field=${field})`,
      );
    } catch (error) {
      console.error(
        `RequestInterceptorManager: Failed to setup listener for ${storageKey}:`,
        error,
      );
    }
  }

  private parseField(field: string): { kind: string; name?: string } {
    const raw = String(field || '').trim();
    const [left, right] = raw.split(':');
    const kind = (left || '').trim();
    const name = (right || '').trim();
    const supported = new Set([
      'request.header',
      'request.body',
      'response.header',
      'request.method',
      'request.url',
      'request.query',
      'response.statusCode',
      'response.statusLine',
      'response.mimeType',
      'response.fromCache',
      'response.ip',
    ]);
    if (!supported.has(kind)) {
      throw new Error(`Unsupported field kind: ${kind}`);
    }
    return { kind, name: name || undefined };
  }

  private extractFromRequestBody(
    details: chrome.webRequest.WebRequestBodyDetails,
    name?: string,
  ): string | undefined {
    const body: any = (details as any).requestBody;
    if (!body) return undefined;

    // formData (e.g., application/x-www-form-urlencoded or multipart/form-data)
    if (body.formData && name) {
      const values = body.formData[name];
      if (Array.isArray(values) && values.length > 0) {
        const v = values[0];
        if (v !== undefined && v !== null) return String(v);
      }
    }

    // raw bytes (e.g., application/json)
    const rawParts = (body.raw || []) as Array<{ bytes?: ArrayBuffer }>;
    for (const part of rawParts) {
      const ab = part && part.bytes;
      if (!ab) continue;
      try {
        const text = new TextDecoder('utf-8').decode(ab as ArrayBuffer);
        if (!name) return text;
        // try JSON first
        try {
          const obj = JSON.parse(text);
          if (obj && Object.prototype.hasOwnProperty.call(obj, name)) {
            const val = obj[name];
            if (val !== undefined && val !== null) return String(val);
          }
        } catch (jsonErr) {
          // not JSON; try URL-encoded
          try {
            const params = new URLSearchParams(text);
            const val = params.get(name);
            if (val !== null) return val;
          } catch (urlErr) {
            // ignore parsing errors
          }
        }
      } catch (e) {
        // ignore decode errors
      }
    }

    return undefined;
  }

  private extractFromRequestHeader(
    details: chrome.webRequest.WebRequestHeadersDetails,
    name?: string,
  ): string | undefined {
    if (!name || !details.requestHeaders) return undefined;
    const h = details.requestHeaders.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return h?.value || undefined;
  }

  private extractFromResponseHeader(
    details: chrome.webRequest.WebResponseHeadersDetails,
    name?: string,
  ): string | undefined {
    if (!name || !details.responseHeaders) return undefined;
    const h = details.responseHeaders.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return h?.value || undefined;
  }

  private storeValue(storageKey: string, value: string | number, field: string) {
    chrome.storage.local
      .set({
        [storageKey]: String(value),
      })
      .then(() => {
        console.log(`RequestInterceptorManager: Captured ${field} -> ${storageKey}`);
      })
      .catch((error) => {
        console.error(`RequestInterceptorManager: Failed to store field for ${storageKey}:`, error);
      });
  }

  /**
   * 移除指定的监听器
   */
  private removeListener(storageKey: string): void {
    const listeners = this.activeListeners.get(storageKey);
    if (!listeners) return;
    try {
      if (listeners.onBeforeRequest) {
        chrome.webRequest.onBeforeRequest.removeListener(listeners.onBeforeRequest);
      }
      if (listeners.onBeforeSendHeaders) {
        chrome.webRequest.onBeforeSendHeaders.removeListener(listeners.onBeforeSendHeaders);
      }
      if (listeners.onHeadersReceived) {
        chrome.webRequest.onHeadersReceived.removeListener(listeners.onHeadersReceived);
      }
      if (listeners.onCompleted) {
        chrome.webRequest.onCompleted.removeListener(listeners.onCompleted);
      }
      this.activeListeners.delete(storageKey);
      console.log(`RequestInterceptorManager: Removed listener(s) for ${storageKey}`);
    } catch (error) {
      console.error(
        `RequestInterceptorManager: Failed to remove listener for ${storageKey}:`,
        error,
      );
    }
  }

  /**
   * 清除所有监听器
   */
  private clearAllListeners(): void {
    for (const storageKey of this.activeListeners.keys()) {
      this.removeListener(storageKey);
    }
  }

  /**
   * 清理资源
   */
  public cleanup(): void {
    this.clearAllListeners();
    this.isInitialized = false;
  }
}

// 全局实例
let requestInterceptorManager: RequestInterceptorManager | null = null;

/**
 * 获取请求拦截器管理器实例
 */
export function getRequestInterceptorManager(): RequestInterceptorManager {
  if (!requestInterceptorManager) {
    requestInterceptorManager = new RequestInterceptorManager();
  }
  return requestInterceptorManager;
}

/**
 * 初始化请求拦截器监听器
 */
export const initRequestInterceptorListener = () => {
  const manager = getRequestInterceptorManager();

  // 初始化管理器
  manager.initialize();

  // 监听配置变更消息
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === BACKGROUND_MESSAGE_TYPES.SAVE_CUSTOM_TOOLS_CONFIG) {
      // 配置保存后重新加载监听器
      manager
        .reloadConfig()
        .then(() => {
          console.log('RequestInterceptorManager: Config reloaded successfully');
        })
        .catch((error) => {
          console.error('RequestInterceptorManager: Failed to reload config:', error);
        });
    }
  });
};
