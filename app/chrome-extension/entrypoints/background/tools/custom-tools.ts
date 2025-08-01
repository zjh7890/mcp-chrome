import { BaseBrowserToolExecutor } from './base-browser';
import { ToolResult } from '@/common/tool-handler';
import { CustomToolConfig, CustomToolResult } from '../types/custom-tools';

/**
 * 自定义工具执行器
 */
export class CustomToolExecutor extends BaseBrowserToolExecutor {
  name = 'custom_tool_executor';

  async execute(args: {
    toolName: string;
    toolConfig: CustomToolConfig;
    args: any;
  }): Promise<ToolResult> {
    const { toolName, toolConfig, args: toolArgs } = args;

    try {
      console.log('CustomToolExecutor: Execute called with args:', {
        toolName,
        toolConfig,
        toolArgs,
      });

      // 获取认证令牌
      const authTokens = await this.getAuthTokens();
      console.log('CustomToolExecutor: Got auth tokens:', authTokens);

      // 直接执行网络请求
      const result = await this.executeNetworkRequest(toolConfig, toolArgs, authTokens);
      console.log('CustomToolExecutor: Network request completed, result:', result);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Custom tool '${toolName}' executed successfully`,
                data: result,
              },
              null,
              2,
            ),
          },
        ],
        isError: false,
      };
    } catch (error: any) {
      console.error(`CustomToolExecutor: Error executing '${toolName}':`, error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: `Failed to execute custom tool '${toolName}'`,
                error: error.message,
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * 获取所有认证令牌
   */
  private async getAuthTokens(): Promise<Record<string, string>> {
    const tokens: Record<string, string> = {};

    try {
      // 获取自定义工具配置
      const result = await chrome.storage.local.get(['custom_tools_config']);
      const config = result.custom_tools_config;

      if (config?.webRequestListeners) {
        // 获取所有启用的监听器的存储键
        const storageKeys = config.webRequestListeners
          .filter((listener: any) => listener.enabled)
          .map((listener: any) => listener.storageKey);

        if (storageKeys.length > 0) {
          const tokenResults = await chrome.storage.local.get(storageKeys);
          Object.assign(tokens, tokenResults);
        }
      }
    } catch (error) {
      console.warn('CustomToolExecutor: Failed to get auth tokens:', error);
    }

    return tokens;
  }

  /**
   * 执行网络请求
   */
  private async executeNetworkRequest(
    toolConfig: CustomToolConfig,
    args: any,
    authTokens: Record<string, string>,
  ): Promise<CustomToolResult> {
    try {
      // 使用新的 requestConfig 配置构建请求
      const requestConfig = this.buildRequestFromConfig(
        toolConfig.requestConfig,
        args,
        authTokens,
        toolConfig,
      );

      console.log('CustomToolExecutor: Built request config:', requestConfig);

      // 创建 AbortController 用于超时控制
      const timeout = toolConfig.requestConfig.timeout || 30000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // 发起网络请求
      const response = await fetch(requestConfig.url, {
        method: requestConfig.method || 'GET',
        headers: requestConfig.headers || {},
        body: requestConfig.body,
        credentials: 'include',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // 解析响应数据
      let data: any;
      const contentType = response.headers.get('content-type') || '';

      try {
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }
      } catch (parseError) {
        data = await response.text();
      }

      // 应用响应过滤
      if (toolConfig.responseFilter && toolConfig.responseFilter.excludeFields) {
        data = this.filterResponseData(data, toolConfig.responseFilter.excludeFields);
      }

      return {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        data: data,
        tool: 'custom_tool',
      };
    } catch (error: any) {
      console.error('CustomToolExecutor: Network request failed:', error);

      let errorMessage = error.message;
      if (error.name === 'AbortError') {
        errorMessage = 'Request timeout';
      }

      return {
        success: false,
        status: 0,
        statusText: 'Error',
        data: null,
        tool: 'custom_tool',
        error: errorMessage,
      };
    }
  }

  /**
   * 从新的 requestConfig 构建网络请求配置
   */
  private buildRequestFromConfig(
    requestConfig: any,
    args: any,
    authTokens: Record<string, string>,
    toolConfig: CustomToolConfig,
  ): {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } {
    // 合并默认值和传入的参数
    const mergedArgs = this.mergeDefaultValues(args, toolConfig);

    // 替换 URL 中的占位符
    const url = this.replacePlaceholders(requestConfig.url, mergedArgs, authTokens);

    // 处理请求头
    const headers: Record<string, string> = { ...requestConfig.headers };
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        headers[key] = this.replacePlaceholders(String(value), mergedArgs, authTokens);
      }
    }

    // 处理请求体
    let body: string | undefined;
    if (requestConfig.body) {
      if (requestConfig.bodyType === 'json') {
        // JSON 格式
        const bodyObj = this.replaceObjectPlaceholders(requestConfig.body, mergedArgs, authTokens);
        body = JSON.stringify(bodyObj);

        // 检查是否已经设置了 Content-Type (大小写不敏感)
        const hasContentType = Object.keys(headers).some(
          (key) => key.toLowerCase() === 'content-type',
        );
        if (!hasContentType) {
          headers['Content-Type'] = 'application/json';
        }
      } else if (requestConfig.bodyType === 'form-data') {
        // Form data 格式
        const formData = new FormData();
        const bodyObj = this.replaceObjectPlaceholders(requestConfig.body, mergedArgs, authTokens);
        for (const [key, value] of Object.entries(bodyObj)) {
          formData.append(key, String(value));
        }
        body = formData as any; // FormData 会被 fetch 自动处理
      } else {
        // 文本格式
        body = this.replacePlaceholders(String(requestConfig.body), mergedArgs, authTokens);
      }
    }

    return {
      url,
      method: requestConfig.method || 'GET',
      headers,
      body,
    };
  }

  /**
   * 合并默认值和传入的参数，并确保正确的数据类型
   */
  private mergeDefaultValues(args: any, toolConfig: CustomToolConfig): any {
    const defaultValues: Record<string, any> = {};
    const mergedArgs: Record<string, any> = { ...args };

    // 从工具配置的 inputSchema 中提取默认值和类型信息
    if (toolConfig.inputSchema && toolConfig.inputSchema.properties) {
      for (const [paramName, paramConfig] of Object.entries(toolConfig.inputSchema.properties)) {
        if (typeof paramConfig === 'object' && paramConfig !== null) {
          // 如果参数没有传入值，使用默认值并确保类型正确
          if (!args || !(paramName in args)) {
            if ('default' in paramConfig) {
              // 确保默认值也符合指定的类型
              defaultValues[paramName] = this.convertToCorrectType(
                paramConfig.default,
                paramConfig.type,
              );
            }
          } else {
            // 如果参数有值，确保类型正确
            mergedArgs[paramName] = this.convertToCorrectType(args[paramName], paramConfig.type);
          }
        }
      }
    }

    return { ...defaultValues, ...mergedArgs };
  }

  /**
   * 根据指定类型转换值
   */
  private convertToCorrectType(value: any, type: string): any {
    if (value === null || value === undefined) {
      return value;
    }

    switch (type) {
      case 'integer': {
        const intValue = parseInt(String(value), 10);
        return isNaN(intValue) ? value : intValue;
      }
      case 'number': {
        const numValue = parseFloat(String(value));
        return isNaN(numValue) ? value : numValue;
      }
      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
          const lowerValue = value.toLowerCase();
          return lowerValue === 'true' || lowerValue === '1';
        }
        return Boolean(value);
      case 'string':
        return String(value);
      case 'object':
        // 如果已经是对象，直接返回
        if (typeof value === 'object' && value !== null) {
          return value;
        }
        // 如果是字符串，尝试解析为 JSON
        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            // 如果解析失败，返回空对象
            return {};
          }
        }
        // 其他情况返回空对象
        return {};
      case 'array':
        // 如果已经是数组，直接返回
        if (Array.isArray(value)) {
          return value;
        }
        // 如果是字符串，尝试解析为 JSON
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            // 如果解析失败，返回空数组
            return [];
          }
        }
        // 其他情况转换为数组
        return Array.isArray(value) ? value : [value];
      default:
        return value;
    }
  }

  /**
   * 替换字符串中的占位符
   */
  private replacePlaceholders(text: string, args: any, authTokens: Record<string, string>): any {
    // 检查是否是单个占位符（整个字符串就是一个占位符）
    const singlePlaceholderRegex = /^\$\{([^}]+)\}$/;
    const singleMatch = text.match(singlePlaceholderRegex);

    if (singleMatch) {
      const paramName = singleMatch[1];

      // 优先检查参数
      if (args && paramName in args) {
        return args[paramName]; // 保持原始类型
      }

      // 检查认证令牌
      if (paramName in authTokens) {
        return authTokens[paramName]; // 认证令牌通常是字符串
      }

      // 如果没找到对应的值，返回原始文本
      return text;
    }

    // 如果不是单个占位符，则进行字符串替换
    let result = text;

    // 替换参数占位符 ${paramName}
    if (args) {
      for (const [key, value] of Object.entries(args)) {
        const placeholder = `\${${key}}`;
        result = result.replace(
          new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          String(value),
        );
      }
    }

    // 替换认证令牌占位符 ${authTokens.tokenName}
    for (const [key, value] of Object.entries(authTokens)) {
      const placeholder = `\${${key}}`;
      result = result.replace(
        new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
        value,
      );
    }

    return result;
  }

  /**
   * 递归替换对象中的占位符
   */
  private replaceObjectPlaceholders(obj: any, args: any, authTokens: Record<string, string>): any {
    if (typeof obj === 'string') {
      return this.replacePlaceholders(obj, args, authTokens);
    } else if (Array.isArray(obj)) {
      return obj.map((item) => this.replaceObjectPlaceholders(item, args, authTokens));
    } else if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.replaceObjectPlaceholders(value, args, authTokens);
      }
      return result;
    }
    return obj;
  }

  /**
   * 过滤响应数据，移除指定的字段
   * @param data 原始响应数据
   * @param excludeFields JSONPath 表达式数组，用于指定要移除的字段
   */
  private filterResponseData(data: any, excludeFields: string[]): any {
    if (!data || !excludeFields || excludeFields.length === 0) {
      return data;
    }

    // 深拷贝数据以避免修改原始数据
    const filteredData = JSON.parse(JSON.stringify(data));

    // 对每个排除字段表达式进行处理
    for (const excludePath of excludeFields) {
      this.removeFieldByPath(filteredData, excludePath);
    }

    return filteredData;
  }

  /**
   * 根据路径移除字段（简单的 JSONPath 实现）
   * @param obj 要处理的对象
   * @param path 字段路径，支持简单的 JSONPath 格式（如 "$[*].items"）
   */
  private removeFieldByPath(obj: any, path: string): void {
    if (!obj || typeof obj !== 'object') return;

    // 简化的 JSONPath 处理，支持常用格式
    // 支持: $[*].fieldName, $.fieldName, fieldName

    if (path.startsWith('$[*].')) {
      // 处理数组中所有元素的字段：$[*].fieldName
      const fieldName = path.substring(5); // 移除 "$[*]."
      if (Array.isArray(obj)) {
        obj.forEach((item) => {
          if (item && typeof item === 'object' && fieldName in item) {
            delete item[fieldName];
          }
        });
      }
    } else if (path.startsWith('$.')) {
      // 处理根对象的字段：$.fieldName
      const fieldName = path.substring(2); // 移除 "$."
      if (fieldName in obj) {
        delete obj[fieldName];
      }
    } else {
      // 直接字段名：fieldName
      if (path in obj) {
        delete obj[path];
      }
      // 如果是数组，也要处理数组中的每个元素
      if (Array.isArray(obj)) {
        obj.forEach((item) => {
          if (item && typeof item === 'object' && path in item) {
            delete item[path];
          }
        });
      }
    }
  }
}

/**
 * 处理自定义工具配置获取
 */
export async function handleGetCustomToolsConfig(): Promise<ToolResult> {
  try {
    const result = await chrome.storage.local.get(['custom_tools_config']);
    const config = result.custom_tools_config || { customTools: [] };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Custom tools config retrieved successfully',
              data: config,
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    console.error('CustomToolExecutor: Failed to get custom tools config:', error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              message: 'Failed to get custom tools config',
              error: error.message,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}

/**
 * 处理自定义工具配置保存
 */
export async function handleSaveCustomToolsConfig(config: any): Promise<ToolResult> {
  try {
    await chrome.storage.local.set({ custom_tools_config: config });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Custom tools config saved successfully',
              data: config,
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    console.error('CustomToolExecutor: Failed to save custom tools config:', error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              message: 'Failed to save custom tools config',
              error: error.message,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}
