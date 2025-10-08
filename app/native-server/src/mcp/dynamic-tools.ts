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
 * 自定义工具配置接口
 */
interface CustomToolConfig {
  name: string;
  description: string;
  valid?: boolean;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * 扩展中的自定义工具配置结构
 */
interface CustomToolsConfig {
  webRequestListeners?: WebRequestListenerConfig[];
  customTools: CustomToolConfig[];
  excludeStaticTools?: string[];
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
   * 获取需要排除的静态工具名称
   */
  public async getExcludedStaticToolNames(): Promise<string[]> {
    try {
      const config = await this.getCustomToolsConfig();
      if (!config || !Array.isArray(config.excludeStaticTools)) return [];
      return config.excludeStaticTools.filter((n) => typeof n === 'string' && n.length > 0);
    } catch {
      return [];
    }
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
