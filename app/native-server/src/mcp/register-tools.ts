import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import nativeMessagingHostInstance from '../native-messaging-host';
import { NativeMessageType, TOOL_SCHEMAS } from 'chrome-mcp-shared';
import { getDynamicToolsManager } from './dynamic-tools';

export const setupTools = (server: Server) => {
  const dynamicToolsManager = getDynamicToolsManager();

  // List tools handler - 合并静态工具和动态工具
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const staticTools = TOOL_SCHEMAS;
    const dynamicTools = await dynamicToolsManager.getCustomToolSchemas();
    // return { tools: [...staticTools, ...dynamicTools] };
    return { tools: [...dynamicTools] };
  });

  // Call tool handler - 路由到相应的工具处理器
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleToolCall(request.params.name, request.params.arguments || {}),
  );
};

const handleToolCall = async (name: string, args: any): Promise<CallToolResult> => {
  try {
    const dynamicToolsManager = getDynamicToolsManager();

    // 检查是否为自定义工具
    if (await dynamicToolsManager.isCustomTool(name)) {
      return await dynamicToolsManager.executeCustomTool(name, args);
    }

    // 发送请求到Chrome扩展并等待响应（处理内置工具）
    const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
      {
        name,
        args,
      },
      NativeMessageType.CALL_TOOL,
      30000, // 30秒超时
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response),
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error calling tool: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
};
