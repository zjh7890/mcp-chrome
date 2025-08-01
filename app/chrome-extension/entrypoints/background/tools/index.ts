import { createErrorResponse, ToolExecutor } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import * as browserTools from './browser';
import {
  CustomToolExecutor,
  handleGetCustomToolsConfig,
  handleSaveCustomToolsConfig,
} from './custom-tools';

const tools = { ...browserTools };
const customToolExecutor = new CustomToolExecutor();

// 创建工具映射
const toolsMap = new Map<string, ToolExecutor>([
  ...Object.values(tools).map((tool): [string, ToolExecutor] => [tool.name, tool]),
  ['get_custom_tools_config', { execute: () => handleGetCustomToolsConfig() }],
  ['save_custom_tools_config', { execute: (args: any) => handleSaveCustomToolsConfig(args) }],
  ['execute_custom_tool', customToolExecutor],
]);

/**
 * Tool call parameter interface
 */
export interface ToolCallParam {
  name: string;
  args: any;
}

/**
 * Handle tool execution
 */
export const handleCallTool = async (param: ToolCallParam) => {
  const tool = toolsMap.get(param.name);
  if (!tool) {
    return createErrorResponse(`Tool ${param.name} not found`);
  }

  try {
    return await tool.execute(param.args);
  } catch (error) {
    console.error(`Tool execution failed for ${param.name}:`, error);
    return createErrorResponse(
      error instanceof Error ? error.message : ERROR_MESSAGES.TOOL_EXECUTION_FAILED,
    );
  }
};
