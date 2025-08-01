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
 * 响应过滤配置接口
 */
export interface ResponseFilterConfig {
  excludeFields?: string[]; // JSONPath 表达式数组，用于指定要屏蔽的字段
}

/**
 * 网络请求配置接口 - 简化版本，避免复杂解析
 */
export interface NetworkRequestConfig {
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
export interface CustomToolConfig {
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
