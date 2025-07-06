/**
 * 请求拦截器配置接口
 */
export interface WebRequestListenerConfig {
  id: string;
  enabled: boolean;
  urlPattern: string;
  headerName: string;
  storageKey: string;
}

/**
 * 自定义工具配置接口
 */
export interface CustomToolConfig {
  name: string;
  description: string;
  fetchCode: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * 自定义工具配置文件结构
 */
export interface CustomToolsConfig {
  webRequestListeners?: WebRequestListenerConfig[];
  customTools: CustomToolConfig[];
}

/**
 * 自定义工具执行结果
 */
export interface CustomToolResult {
  success: boolean;
  status: number;
  statusText: string;
  data: any;
  tool: string;
  error?: string;
}
