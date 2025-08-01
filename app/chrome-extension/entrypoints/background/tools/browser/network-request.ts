import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

const DEFAULT_NETWORK_REQUEST_TIMEOUT = 30000;

interface NetworkRequestToolParams {
  url: string; // URL is always required
  method?: string; // Defaults to GET
  headers?: Record<string, string>; // User-provided headers
  body?: any; // User-provided body
  timeout?: number; // Timeout for the network request itself
}

/**
 * NetworkRequestTool - Sends network requests directly from background script with cookies.
 */
class NetworkRequestTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NETWORK_REQUEST;

  async execute(args: NetworkRequestToolParams): Promise<ToolResult> {
    const {
      url,
      method = 'GET',
      headers = {},
      body,
      timeout = DEFAULT_NETWORK_REQUEST_TIMEOUT,
    } = args;

    console.log(`NetworkRequestTool: Executing with options:`, args);

    if (!url) {
      return createErrorResponse('URL parameter is required.');
    }

    try {
      // Create AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Prepare fetch options
      const fetchOptions: RequestInit = {
        method: method.toUpperCase(),
        headers: headers,
        credentials: 'include', // Automatically include cookies
        signal: controller.signal,
      };

      // Add body if provided and method supports it
      if (body && !['GET', 'HEAD'].includes(method.toUpperCase())) {
        if (typeof body === 'string') {
          fetchOptions.body = body;
        } else {
          fetchOptions.body = JSON.stringify(body);
          // Set content-type header if not already provided
          if (!headers['Content-Type'] && !headers['content-type']) {
            fetchOptions.headers = {
              ...headers,
              'Content-Type': 'application/json',
            };
          }
        }
      }

      console.log(`NetworkRequestTool: Making request to ${url} with method ${method}`);

      // Make the request
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      // Parse response based on content type
      const contentType = response.headers.get('content-type') || '';
      let responseData: any;

      try {
        if (contentType.includes('application/json')) {
          responseData = await response.json();
        } else if (contentType.includes('text/') || contentType.includes('application/xml')) {
          responseData = await response.text();
        } else {
          // For binary data, convert to base64
          const buffer = await response.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
          responseData = {
            type: 'binary',
            data: base64,
            contentType: contentType,
          };
        }
      } catch (parseError) {
        // If parsing fails, try to get as text
        responseData = await response.text();
      }

      // Collect response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const result = {
        success: true,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data: responseData,
        url: response.url,
      };

      console.log(`NetworkRequestTool: Response received:`, {
        status: result.status,
        statusText: result.statusText,
        dataType: typeof result.data,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: false,
      };
    } catch (error: any) {
      console.error('NetworkRequestTool: Error sending network request:', error);
      return createErrorResponse(
        `Error sending network request: ${error.message || String(error)}`,
      );
    }
  }
}

export const networkRequestTool = new NetworkRequestTool();
