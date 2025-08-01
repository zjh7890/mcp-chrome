import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import { CustomToolsConfig, WebRequestListenerConfig } from './types/custom-tools';

/**
 * 请求拦截器管理器
 * 用于拦截和处理 HTTP 请求，提取所需的请求头信息
 */
export class RequestInterceptorManager {
  private activeListeners: Map<
    string,
    (details: chrome.webRequest.WebRequestHeadersDetails) => void
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
    const { urlPattern, headerName, storageKey } = listener;

    // 如果已经有相同的监听器，先移除
    if (this.activeListeners.has(storageKey)) {
      this.removeListener(storageKey);
    }

    try {
      // 创建新的监听器
      const requestListener = (details: chrome.webRequest.WebRequestHeadersDetails) => {
        this.handleRequest(details, headerName, storageKey);
      };

      // 注册监听器
      chrome.webRequest.onBeforeSendHeaders.addListener(requestListener, { urls: [urlPattern] }, [
        'requestHeaders',
      ]);

      // 保存监听器引用
      this.activeListeners.set(storageKey, requestListener);

      console.log(`RequestInterceptorManager: Setup listener for ${storageKey} on ${urlPattern}`);
    } catch (error) {
      console.error(
        `RequestInterceptorManager: Failed to setup listener for ${storageKey}:`,
        error,
      );
    }
  }

  /**
   * 处理请求并提取指定的请求头
   */
  private handleRequest(
    details: chrome.webRequest.WebRequestHeadersDetails,
    headerName: string,
    storageKey: string,
  ): void {
    if (!details.requestHeaders) {
      return;
    }

    // 查找指定的请求头
    const targetHeader = details.requestHeaders.find(
      (header) => header.name.toLowerCase() === headerName.toLowerCase(),
    );

    if (targetHeader && targetHeader.value) {
      // 存储请求头值
      chrome.storage.local
        .set({
          [storageKey]: targetHeader.value,
        })
        .then(() => {
          console.log(`RequestInterceptorManager: Captured header ${headerName} for ${storageKey}`);
        })
        .catch((error) => {
          console.error(
            `RequestInterceptorManager: Failed to store header for ${storageKey}:`,
            error,
          );
        });
    }
  }

  /**
   * 移除指定的监听器
   */
  private removeListener(storageKey: string): void {
    const listener = this.activeListeners.get(storageKey);
    if (listener) {
      try {
        chrome.webRequest.onBeforeSendHeaders.removeListener(listener);
        this.activeListeners.delete(storageKey);
        console.log(`RequestInterceptorManager: Removed listener for ${storageKey}`);
      } catch (error) {
        console.error(
          `RequestInterceptorManager: Failed to remove listener for ${storageKey}:`,
          error,
        );
      }
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
