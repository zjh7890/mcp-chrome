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
      // 获取认证令牌
      const authTokens = await this.getAuthTokens(toolConfig);

      // 替换 fetchCode 中的参数
      const executableCode = this.replacePlaceholders(toolConfig.fetchCode, toolArgs, authTokens);

      // 执行 fetch 代码
      const result = await this.executeFetchCode(executableCode);

      return {
        success: true,
        message: `Custom tool '${toolName}' executed successfully`,
        data: result,
      };
    } catch (error: any) {
      console.error(`CustomToolExecutor: Error executing '${toolName}':`, error);
      return {
        success: false,
        message: `Failed to execute custom tool '${toolName}'`,
        error: error.message,
      };
    }
  }

  /**
   * 获取认证令牌
   */
  private async getAuthTokens(toolConfig: CustomToolConfig): Promise<Record<string, string>> {
    const tokens: Record<string, string> = {};

    if (toolConfig.webRequestListener?.enabled) {
      const { storageKey } = toolConfig.webRequestListener;
      try {
        const result = await chrome.storage.local.get([storageKey]);
        if (result[storageKey]) {
          tokens[storageKey] = result[storageKey];
        }
      } catch (error) {
        console.warn(`CustomToolExecutor: Failed to get token for ${storageKey}:`, error);
      }
    }

    return tokens;
  }

  /**
   * 替换 fetchCode 中的占位符
   */
  private replacePlaceholders(
    fetchCode: string,
    args: any,
    authTokens: Record<string, string>,
  ): string {
    let result = fetchCode;

    // 替换参数占位符
    if (args) {
      for (const [key, value] of Object.entries(args)) {
        const placeholder = `\${${key}}`;
        result = result.replace(
          new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          String(value),
        );
      }
    }

    // 替换认证令牌占位符
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
   * 执行 fetch 代码
   */
  private async executeFetchCode(code: string): Promise<CustomToolResult> {
    try {
      // 在一个安全的环境中执行 fetch 代码
      const fetchFunction = new Function('fetch', `return (${code})`);
      const response = await fetchFunction(fetch);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        data,
        tool: 'custom_tool',
      };
    } catch (error: any) {
      console.error('CustomToolExecutor: Failed to execute fetch code:', error);
      return {
        success: false,
        status: 0,
        statusText: 'Error',
        data: null,
        tool: 'custom_tool',
        error: error.message,
      };
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
      success: true,
      message: 'Custom tools config retrieved successfully',
      data: config,
    };
  } catch (error: any) {
    console.error('CustomToolExecutor: Failed to get custom tools config:', error);
    return {
      success: false,
      message: 'Failed to get custom tools config',
      error: error.message,
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
      success: true,
      message: 'Custom tools config saved successfully',
      data: config,
    };
  } catch (error: any) {
    console.error('CustomToolExecutor: Failed to save custom tools config:', error);
    return {
      success: false,
      message: 'Failed to save custom tools config',
      error: error.message,
    };
  }
}
