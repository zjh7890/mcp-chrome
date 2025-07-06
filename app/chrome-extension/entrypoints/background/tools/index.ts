import { createErrorResponse } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import * as browserTools from './browser';
import {
  CustomToolExecutor,
  handleGetCustomToolsConfig,
  handleSaveCustomToolsConfig,
} from './custom-tools';

const tools = { ...browserTools };
const customToolExecutor = new CustomToolExecutor();

// 添加自定义工具相关的内置工具
const customToolsMap = new Map([
  [
    'get_custom_tools_config',
    { name: 'get_custom_tools_config', execute: handleGetCustomToolsConfig },
  ],
  [
    'save_custom_tools_config',
    { name: 'save_custom_tools_config', execute: handleSaveCustomToolsConfig },
  ],
  ['execute_custom_tool', customToolExecutor],
]);

const toolsMap = new Map([
  ...Object.values(tools).map((tool) => [tool.name, tool]),
  ...customToolsMap,
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
