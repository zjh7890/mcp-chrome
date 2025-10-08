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
    // 读取需要排除的静态工具名称
    const excluded = await dynamicToolsManager.getExcludedStaticToolNames();
    const filteredStatic = Array.isArray(excluded)
      ? staticTools.filter((t) => !excluded.includes(t.name))
      : staticTools;
    return { tools: [...filteredStatic, ...dynamicTools] };
  });

  // Call tool handler - 路由到相应的工具处理器
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleToolCall(request.params.name, request.params.arguments || {}),
  );
};

const handleToolCall = async (name: string, args: any): Promise<CallToolResult> => {
  try {
    // 发送请求到Chrome扩展并等待响应（保持原始行为：直接透传 name/args）
    const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
      {
        name,
        args,
      },
      NativeMessageType.CALL_TOOL,
      30000, // 30秒超时
    );
    if (response.status === 'success') {
      return response.data;
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `Error calling tool: ${response.error}`,
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
          text: `Error calling tool: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
};
