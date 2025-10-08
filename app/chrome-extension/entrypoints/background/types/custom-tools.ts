/**
 * 请求拦截器配置接口
 */
export interface WebRequestListenerConfig {
  id: string;
  enabled: boolean;
  urlPattern: string;
  /**
   * 通用字段选择器，替代 headerName。
   * 示例：
   * - "request.header:Authorization"
   * - "response.header:content-type"
   * - "request.method"
   * - "request.url"
   * - "request.query:userId"
   * - "response.statusCode"
   * - "response.statusLine"
   */
  field: string;
  storageKey: string;
}

/**
 * 响应过滤配置接口
 */
// 已移除：ResponseFilterConfig/ListFilterConfig/FilterCondition

/**
 * 自定义工具配置接口
 */
export interface CustomToolConfig {
  name: string;
  description: string;
  // 可选：控制是否对外暴露（默认为 true）。当为 false 时，不传递给 native-server
  valid?: boolean;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  // JSONata 脚本（字符串或按行定义的字符串数组）
  script?: string | string[];
}

/**
 * 自定义工具配置文件结构
 */
export interface CustomToolsConfig {
  webRequestListeners?: WebRequestListenerConfig[];
  customTools: CustomToolConfig[];
  /**
   * 需要从静态工具列表中排除的工具名称（按 Tool.name 匹配）
   */
  excludeStaticTools?: string[];
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
