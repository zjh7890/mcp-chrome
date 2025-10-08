import { BaseBrowserToolExecutor } from './base-browser';
import { ToolResult } from '@/common/tool-handler';
import { CustomToolConfig, CustomToolResult } from '../types/custom-tools';
import jsonata from 'jsonata';

/**
 * 自定义工具执行器
 */
export class CustomToolExecutor extends BaseBrowserToolExecutor {
  name = 'custom_tool_executor';

  async execute(args: { toolName: string; args: any }): Promise<ToolResult> {
    const { toolName, args: toolArgs } = args;

    try {
      console.log('CustomToolExecutor: Execute called with args:', {
        toolName,
        toolArgs,
      });

      // 获取监听器数据（如认证信息等）
      const listenerData = await this.getListenerData();
      console.log('CustomToolExecutor: Got listener data:', listenerData);

      // 按名称查找工具配置
      const resolvedToolConfig = await this.findToolConfigByName(toolName);
      if (!resolvedToolConfig) {
        throw new Error(`Custom tool config not found for name: ${toolName}`);
      }

      // 使用 script(JSONata) 统一执行，script 可为字符串或字符串数组
      const data = await this.executeScript(resolvedToolConfig, toolArgs, listenerData);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data),
          },
        ],
        isError: true,
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
   * 根据名称查找自定义工具配置
   */
  private async findToolConfigByName(name: string): Promise<CustomToolConfig | undefined> {
    try {
      const result = await chrome.storage.local.get(['custom_tools_config']);
      const config = result.custom_tools_config;
      const list: CustomToolConfig[] = config?.customTools || [];
      return list.find((t) => t.name === name);
    } catch (e) {
      console.warn('CustomToolExecutor: findToolConfigByName failed:', e);
      return undefined;
    }
  }

  /**
   * 获取所有认证令牌
   */
  private async getListenerData(): Promise<Record<string, string>> {
    const data: Record<string, string> = {};

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
          const results = await chrome.storage.local.get(storageKeys);
          Object.assign(data, results);
        }
      }
    } catch (error) {
      console.warn('CustomToolExecutor: Failed to get listener data:', error);
    }

    return data;
  }

  /**
   * 执行 JSONata 脚本
   */
  private async executeScript(
    toolConfig: CustomToolConfig,
    args: any,
    listenerData: Record<string, string>,
  ): Promise<any> {
    const script = toolConfig.script;
    if (!Array.isArray(script) || script.length === 0) {
      throw new Error(`Tool '${toolConfig.name}' missing script`);
    }

    // 预处理：占位符替换（支持 `${param}` / `${token}`）
    const exprSource = script.map((line) => String(line)).join('\n');

    const expr = jsonata(exprSource);

    // 注册内置函数
    this.registerJsonataFunctions(expr);

    // 合并默认值并执行
    const mergedArgs = this.mergeDefaultValues(args, toolConfig);
    const result = await expr.evaluate({}, { ARGS: mergedArgs, LISTENER_DATA: listenerData });
    return result;
  }

  // JSONata: 注册 $fetch / $body / $callTool
  private registerJsonataFunctions(expr: any) {
    // $fetch(url, init) - 精简版：直接透传 init 给浏览器 fetch，不做额外处理
    expr.registerFunction('fetch', async (url: any, init: any) => {
      const urlStr = String(url);
      const requestInit = init && typeof init === 'object' ? (init as any) : {};
      const resp = await fetch(urlStr, requestInit as any);
      return resp as any;
    });

    // $body(response, type)
    expr.registerFunction('body', async (resp: any, type: any) => {
      if (!resp) return null;
      const mode = String(type || 'text');
      switch (mode) {
        case 'json': {
          try {
            const status = (resp as any).status;
            if (status === 204 || status === 205) return null;

            const headers = (resp as any).headers;
            const contentLength =
              headers && typeof headers.get === 'function' ? headers.get('content-length') : null;
            if (contentLength === '0') return null;

            const text = await (resp as any).text();
            if (!text || String(text).trim().length === 0) return null;
            try {
              return JSON.parse(text);
            } catch {
              // 非严格 JSON，返回原始文本以便调用方自行处理
              return text;
            }
          } catch {
            try {
              return await (resp as any).json();
            } catch {
              return null;
            }
          }
        }
        case 'text':
          return await resp.text();
        case 'arrayBuffer':
          return await resp.arrayBuffer();
        case 'blob':
          return await resp.blob();
        case 'bytes': {
          const buf = await resp.arrayBuffer();
          return new Uint8Array(buf);
        }
        case 'formData':
          return await (resp as any).formData();
        default:
          return await resp.text();
      }
    });

    // $jsonStringify(value) - 用于构造 JSON 请求体字符串
    expr.registerFunction('jsonStringify', (value: any) => {
      try {
        return JSON.stringify(value);
      } catch (e) {
        return '';
      }
    });

    // $parseJsonString(value) - 尝试反序列化 JSON 字符串；
    // - 若已是对象/数组，直接透传返回
    // - 若是字符串则尝试 JSON.parse，失败返回 'INVALID_JSON_STRING'
    // - 其他类型（null/undefined/number/boolean）返回 'INVALID_JSON_STRING'
    expr.registerFunction('parseJsonString', (value: any) => {
      try {
        if (value != null && typeof value === 'object') return value;
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed.length === 0) return 'INVALID_JSON_STRING';
          return JSON.parse(trimmed);
        }
        return 'INVALID_JSON_STRING';
      } catch {
        return 'INVALID_JSON_STRING';
      }
    });

    // $callTool(name, args)
    expr.registerFunction('callTool', async (name: any, params: any) => {
      const nameStr = String(name);
      const subArgs = params || {};
      const subResult = await this.execute({ toolName: nameStr, args: subArgs });
      try {
        const first =
          subResult.content && subResult.content[0] && (subResult.content[0] as any).text;
        const parsed = first ? JSON.parse(first) : null;
        return parsed;
      } catch {
        return null;
      }
    });

    // $getOrCreateTab(url) -> { id, url, title }
    expr.registerFunction('getOrCreateTab', async (url: any) => {
      const urlStr = String(url);

      const normalize = (u?: string | null) => {
        if (!u) return '';
        try {
          const obj = new URL(u);
          // 忽略末尾斜杠与哈希
          const base = `${obj.origin}${obj.pathname}`.replace(/\/$/, '');
          return base;
        } catch {
          return String(u).replace(/\/$/, '');
        }
      };

      const target = normalize(urlStr);
      let tab: chrome.tabs.Tab | undefined;

      try {
        const allTabs = await chrome.tabs.query({});
        const matches = allTabs.filter((t) => {
          const tu = normalize(t.url);
          if (!tu || !target) return false;
          // 单向前缀匹配：tabUrl 等于 target 或以 target/ 为前缀
          if (tu === target) return true;
          if (tu.startsWith(target + '/')) return true;
          return false;
        });
        if (matches.length > 0) {
          tab = matches[0];
        } else {
          tab = await chrome.tabs.create({ url: urlStr, active: true });
          // 简单等待页面加载一会，避免立即注入失败
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      } catch (e) {
        console.warn('$getOrCreateTab failed:', e);
        return null;
      }

      if (!tab || !tab.id) return null;
      return { id: tab.id, url: tab.url || urlStr, title: tab.title || '' } as any;
    });

    // $contentScriptFetch(tab, url, init) -> Response-like
    expr.registerFunction('contentScriptFetch', async (tabArg: any, url: any, init: any) => {
      const resolveTabId = async (arg: any): Promise<number | null> => {
        if (arg == null) return null;
        if (typeof arg === 'number') return arg;
        if (typeof arg === 'string') {
          try {
            // 依赖已注册的 $getOrCreateTab 完成查找/创建与有效性校验
            const getter = (expr as any).functions.get('getOrCreateTab');
            const ret =
              getter && getter.implementation ? await getter.implementation.call(null, arg) : null;
            return ret && ret.id ? Number(ret.id) : null;
          } catch {
            return null;
          }
        }
        if (typeof arg === 'object' && arg.id != null) return Number(arg.id);
        return null;
      };

      const tabId = await resolveTabId(tabArg);
      if (!tabId) return null;

      const urlStr = String(url);
      const requestInit = init && typeof init === 'object' ? (init as any) : {};

      try {
        // 注入网络请求辅助脚本
        await this.injectContentScript(tabId, ['inject-scripts/network-helper.js']);

        const timeout = typeof requestInit.timeout === 'number' ? requestInit.timeout : 30000;
        const method = requestInit.method ? String(requestInit.method) : 'GET';
        const headers =
          requestInit.headers && typeof requestInit.headers === 'object' ? requestInit.headers : {};
        const body = requestInit.body != null ? requestInit.body : undefined;

        const resp = await this.sendMessageToTab(tabId, {
          action: 'sendPureNetworkRequest',
          url: urlStr,
          method,
          headers,
          body,
          timeout,
        });

        if (!resp || resp.success !== true || !resp.response) {
          throw new Error(
            resp && resp.error ? String(resp.error) : 'Unknown contentScriptFetch error',
          );
        }

        const responseData = resp.response as {
          status: number;
          statusText: string;
          headers: Record<string, string>;
          body: any;
        };

        // 构造一个 Response-like 对象，供 $body 使用
        const headersMap = responseData.headers || {};
        const lowerKey = (k: string) => k.toLowerCase();

        const bodyData = responseData.body;

        const responseLike = {
          status: responseData.status,
          statusText: responseData.statusText,
          headers: {
            get(name: string) {
              const n = lowerKey(String(name));
              // 优先小写匹配
              if (headersMap[n] != null) return headersMap[n];
              // 其次原样 key
              if (headersMap[name] != null) return headersMap[name];
              // 最后尝试大小写遍历
              const found = Object.keys(headersMap).find((k) => k.toLowerCase() === n);
              return found ? headersMap[found] : null;
            },
          },
          async text() {
            if (typeof bodyData === 'string') return bodyData;
            try {
              return JSON.stringify(bodyData);
            } catch {
              return String(bodyData);
            }
          },
          async json() {
            if (typeof bodyData === 'string') {
              try {
                return JSON.parse(bodyData);
              } catch {
                // 返回原始字符串以便上层处理
                return bodyData;
              }
            }
            return bodyData;
          },
          async arrayBuffer() {
            const encoder = new TextEncoder();
            const txt = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
            return encoder.encode(txt).buffer;
          },
          async blob() {
            const txt = await this.text.call(this);
            return new Blob([txt]);
          },
          async formData() {
            throw new Error('formData() is not supported by contentScriptFetch result');
          },
        } as any;

        return responseLike;
      } catch (e) {
        console.warn('$contentScriptFetch failed:', e);
        throw e;
      }
    });
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

  // 已移除：占位符替换逻辑，脚本内请直接使用 $ARGS / $LISTENER_DATA
}

/**
 * 处理自定义工具配置获取
 */
export async function handleGetCustomToolsConfig(): Promise<ToolResult> {
  try {
    const result = await chrome.storage.local.get(['custom_tools_config']);
    const config = result.custom_tools_config || { customTools: [] };

    // 将 inputSchema 中的 object/array 类型映射为 string（对外暴露给 MCP 客户端使用）
    const transformInputSchemaForClient = (inputSchema: any): any => {
      try {
        if (!inputSchema || typeof inputSchema !== 'object') return inputSchema;
        const cloned = JSON.parse(JSON.stringify(inputSchema));
        if (!cloned.properties || typeof cloned.properties !== 'object') return cloned;

        for (const [key, propConfig] of Object.entries<any>(cloned.properties)) {
          if (!propConfig || typeof propConfig !== 'object') continue;
          const originalType = propConfig.type;
          if (originalType === 'object' || originalType === 'array') {
            propConfig.type = 'string';
          }
        }

        return cloned;
      } catch {
        return inputSchema;
      }
    };

    const transformedConfig = {
      ...config,
      customTools: Array.isArray(config.customTools)
        ? config.customTools
            // 先过滤掉无效项（支持 boolean false 与字符串 "false"）
            .filter((t: any) => t && String(t.valid ?? 'true').toLowerCase() !== 'false')
            // 再做入参 schema 映射
            .map((t: any) => ({
              ...t,
              inputSchema: transformInputSchemaForClient(t.inputSchema),
            }))
        : [],
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Custom tools config retrieved successfully',
              data: transformedConfig,
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
