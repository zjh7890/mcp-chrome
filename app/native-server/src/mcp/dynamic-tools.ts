import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import nativeMessagingHostInstance from '../native-messaging-host';
import { NativeMessageType } from 'chrome-mcp-shared';

/**
 * Web请求监听器配置接口
 */
interface WebRequestListenerConfig {
  id: string;
  enabled: boolean;
  urlPattern: string;
  headerName: string;
  storageKey: string;
}

/**
 * 响应过滤配置接口
 */
interface ResponseFilterConfig {
  excludeFields?: string[]; // JSONPath 表达式数组，用于指定要屏蔽的字段
}

/**
 * 网络请求配置接口
 */
interface NetworkRequestConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  bodyType?: 'json' | 'text' | 'form-data';
  timeout?: number;
}

/**
 * 自定义工具配置接口
 */
interface CustomToolConfig {
  name: string;
  description: string;
  requestConfig: NetworkRequestConfig;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  responseFilter?: ResponseFilterConfig; // 可选的响应过滤配置
}

/**
 * 扩展中的自定义工具配置结构
 */
interface CustomToolsConfig {
  webRequestListeners?: WebRequestListenerConfig[];
  customTools: CustomToolConfig[];
}

/**
 * 动态工具管理器
 * 负责从Chrome扩展获取自定义工具配置，并提供工具schema和执行功能
 */
export class DynamicToolsManager {
  /**
   * 从扩展获取自定义工具配置
   */
  private async fetchCustomToolsConfigFromExtension(): Promise<CustomToolsConfig> {
    try {
      const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
        {
          name: 'get_custom_tools_config',
          args: {},
        },
        NativeMessageType.CALL_TOOL,
        10000, // 10秒超时
      );

      // 检查响应的状态
      if (response.status === 'success' && response.data) {
        // response.data 包含扩展工具返回的实际数据
        const toolResult = response.data;

        // 检查是否是 MCP 工具调用的返回格式 (content 数组)
        if (
          toolResult.content &&
          Array.isArray(toolResult.content) &&
          toolResult.content.length > 0
        ) {
          try {
            // 解析 content[0].text 中的 JSON 数据
            const textContent = toolResult.content[0].text;
            const parsedData = JSON.parse(textContent);

            if (parsedData.success && parsedData.data) {
              const config = parsedData.data as CustomToolsConfig;
              return config;
            } else {
              return { customTools: [] };
            }
          } catch (parseError: any) {
            return { customTools: [] };
          }
        } else if (toolResult.success && toolResult.data) {
          // 直接的数据格式（向后兼容）
          const config = toolResult.data as CustomToolsConfig;
          return config;
        } else {
          return { customTools: [] };
        }
      } else if (response.status === 'error') {
        return { customTools: [] };
      } else {
        return { customTools: [] };
      }
    } catch (error: any) {
      return { customTools: [] };
    }
  }

  /**
   * 获取自定义工具配置（实时获取）
   */
  private async getCustomToolsConfig(): Promise<CustomToolsConfig> {
    // 直接从扩展获取最新配置
    return await this.fetchCustomToolsConfigFromExtension();
  }

  /**
   * 刷新配置（由于已移除缓存，此方法保留用于兼容性）
   */
  public async refreshConfig(): Promise<void> {
    // 由于已移除缓存，直接获取配置即可
    await this.getCustomToolsConfig();
  }

  /**
   * 获取自定义工具的MCP工具schema
   */
  public async getCustomToolSchemas(): Promise<Tool[]> {
    try {
      const config = await this.getCustomToolsConfig();

      if (!config.customTools || config.customTools.length === 0) {
        return [];
      }

      const schemas: Tool[] = config.customTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      return schemas;
    } catch (error: any) {
      return [];
    }
  }

  /**
   * 检查是否为自定义工具
   */
  public async isCustomTool(toolName: string): Promise<boolean> {
    try {
      const config = await this.getCustomToolsConfig();
      return config.customTools.some((tool) => tool.name === toolName);
    } catch (error: any) {
      return false;
    }
  }

  /**
   * 执行自定义工具
   */
  public async executeCustomTool(toolName: string, args: any): Promise<CallToolResult> {
    try {
      const config = await this.getCustomToolsConfig();
      const toolConfig = config.customTools.find((tool) => tool.name === toolName);

      if (!toolConfig) {
        return {
          content: [
            {
              type: 'text',
              text: `Custom tool '${toolName}' not found`,
            },
          ],
          isError: true,
        };
      }

      // 通过扩展执行自定义工具
      const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
        {
          name: 'execute_custom_tool',
          args: {
            toolName,
            toolConfig,
            args,
          },
        },
        NativeMessageType.CALL_TOOL,
        30000, // 30秒超时
      );

      if (response.status === 'success' && response.data) {
        const toolResult = response.data;

        // 检查是否是 MCP 工具调用结果格式 (content 数组)
        if (toolResult.content && Array.isArray(toolResult.content)) {
          return {
            content: toolResult.content,
            isError: toolResult.isError || false,
          };
        }
        // 检查旧格式的响应 (向后兼容)
        else if (toolResult.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(toolResult.data, null, 2),
              },
            ],
            isError: false,
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `Failed to execute custom tool '${toolName}': ${toolResult.error || 'Unknown error'}`,
              },
            ],
            isError: true,
          };
        }
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to execute custom tool '${toolName}': ${response.error || response.message || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing custom tool '${toolName}': ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * 获取所有自定义工具的名称列表
   */
  public async getCustomToolNames(): Promise<string[]> {
    try {
      const config = await this.getCustomToolsConfig();
      return config.customTools.map((tool) => tool.name);
    } catch (error: any) {
      return [];
    }
  }

  /**
   * 获取自定义工具的详细信息
   */
  public async getCustomToolInfo(toolName: string): Promise<CustomToolConfig | null> {
    try {
      const config = await this.getCustomToolsConfig();
      return config.customTools.find((tool) => tool.name === toolName) || null;
    } catch (error: any) {
      return null;
    }
  }
}

// 单例实例
let dynamicToolsManagerInstance: DynamicToolsManager | null = null;

/**
 * 获取动态工具管理器实例
 */
export function getDynamicToolsManager(): DynamicToolsManager {
  if (!dynamicToolsManagerInstance) {
    dynamicToolsManagerInstance = new DynamicToolsManager();
  }
  return dynamicToolsManagerInstance;
}

/**
 * 重置动态工具管理器实例（主要用于测试）
 */
export function resetDynamicToolsManager(): void {
  dynamicToolsManagerInstance = null;
}
