# 自定义工具配置指南

在 chrome 调试器把网络请求的 fetch 拷贝出来，然后让 AI 生成对应的自定义工具配置 <br/>

#### 配置格式概览

自定义工具配置文件包含两个主要部分：

- `webRequestListeners`: 请求拦截器配置，用于自动获取认证令牌
- `customTools`: 自定义工具定义

## 配置格式

使用 `requestConfig` 对象来定义网络请求，避免了复杂的 JavaScript 代码解析：

```json
{
  "name": "get_weather",
  "description": "获取天气信息",
  "inputSchema": {
    "type": "object",
    "properties": {
      "city": {
        "type": "string",
        "description": "城市名称"
      }
    },
    "required": ["city"]
  },
  "requestConfig": {
    "url": "https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${api_key}",
    "method": "GET",
    "headers": {
      "Accept": "application/json"
    },
    "timeout": 10000
  }
}
```

### requestConfig 配置项

| 字段       | 类型   | 必需 | 描述                                    |
| ---------- | ------ | ---- | --------------------------------------- |
| `url`      | string | 是   | 请求URL，支持占位符                     |
| `method`   | string | 否   | HTTP方法，默认为 "GET"                  |
| `headers`  | object | 否   | 请求头                                  |
| `body`     | any    | 否   | 请求体数据                              |
| `bodyType` | string | 否   | 请求体类型："json", "form-data", "text" |
| `timeout`  | number | 否   | 超时时间（毫秒），默认30000             |

### responseFilter 配置项（可选）

用于过滤响应数据中不需要的字段：

| 字段            | 类型     | 必需 | 描述                                 |
| --------------- | -------- | ---- | ------------------------------------ |
| `excludeFields` | string[] | 否   | JSONPath表达式数组，指定要移除的字段 |

#### 支持的 JSONPath 格式

1. **数组中所有元素的字段**: `$[*].fieldName`
   - 移除响应数组中每个对象的指定字段
   - 例如: `$[*].items` 会移除所有数组元素中的 `items` 字段

2. **根对象的字段**: `$.fieldName`
   - 移除根对象的指定字段
   - 例如: `$.metadata` 会移除根对象的 `metadata` 字段

3. **直接字段名**: `fieldName`
   - 移除对象中的指定字段（支持嵌套和数组处理）
   - 例如: `items` 会移除所有 `items` 字段

### 占位符语法

- 参数占位符：`${paramName}` - 引用输入参数
- 认证令牌：`${tokenName}` - 引用存储的认证令牌

### 请求体类型

#### JSON 格式 (`bodyType: "json"`)

```json
{
  "requestConfig": {
    "method": "POST",
    "body": {
      "title": "${title}",
      "content": "${content}"
    },
    "bodyType": "json"
  }
}
```

#### 表单数据 (`bodyType: "form-data"`)

```json
{
  "requestConfig": {
    "method": "POST",
    "body": {
      "name": "${name}",
      "email": "${email}"
    },
    "bodyType": "form-data"
  }
}
```

#### 纯文本 (`bodyType: "text"`)

```json
{
  "requestConfig": {
    "method": "POST",
    "body": "Plain text content: ${content}",
    "bodyType": "text"
  }
}
```

## 认证配置

### 请求拦截器设置

```json
{
  "webRequestListeners": [
    {
      "id": "api_listener",
      "enabled": true,
      "urlPattern": "*://api.example.com/*",
      "headerName": "authorization",
      "storageKey": "api_token"
    }
  ]
}
```

### 在工具中使用认证令牌

```json
{
  "requestConfig": {
    "url": "https://api.example.com/data",
    "headers": {
      "Authorization": "Bearer ${api_token}"
    }
  }
}
```

## 完整配置示例

```json
{
  "webRequestListeners": [
    {
      "id": "weather_api",
      "enabled": true,
      "urlPattern": "*://api.openweathermap.org/*",
      "headerName": "authorization",
      "storageKey": "weather_api_key"
    },
    {
      "id": "github_api",
      "enabled": true,
      "urlPattern": "*://api.github.com/*",
      "headerName": "authorization",
      "storageKey": "github_token"
    }
  ],
  "customTools": [
    {
      "name": "get_weather",
      "description": "获取城市天气信息",
      "inputSchema": {
        "type": "object",
        "properties": {
          "city": {
            "type": "string",
            "description": "城市名称"
          },
          "units": {
            "type": "string",
            "description": "温度单位",
            "enum": ["metric", "imperial"],
            "default": "metric"
          }
        },
        "required": ["city"]
      },
      "requestConfig": {
        "url": "https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${weather_api_key}&units=${units}",
        "method": "GET",
        "headers": {
          "Accept": "application/json",
          "User-Agent": "Custom Weather Tool"
        },
        "timeout": 15000
      }
    },
    {
      "name": "create_github_issue",
      "description": "创建GitHub Issue",
      "inputSchema": {
        "type": "object",
        "properties": {
          "owner": {
            "type": "string",
            "description": "仓库所有者"
          },
          "repo": {
            "type": "string",
            "description": "仓库名称"
          },
          "title": {
            "type": "string",
            "description": "Issue标题"
          },
          "body": {
            "type": "string",
            "description": "Issue内容"
          }
        },
        "required": ["owner", "repo", "title"]
      },
      "requestConfig": {
        "url": "https://api.github.com/repos/${owner}/${repo}/issues",
        "method": "POST",
        "headers": {
          "Authorization": "Bearer ${github_token}",
          "Accept": "application/vnd.github.v3+json"
        },
        "body": {
          "title": "${title}",
          "body": "${body}"
        },
        "bodyType": "json",
        "timeout": 30000
      }
    },
    {
      "name": "simple_get_request",
      "description": "简单的GET请求示例",
      "inputSchema": {
        "type": "object",
        "properties": {
          "userId": {
            "type": "string",
            "description": "用户ID"
          }
        },
        "required": ["userId"]
      },
      "requestConfig": {
        "url": "https://jsonplaceholder.typicode.com/users/${userId}",
        "method": "GET",
        "headers": {
          "Accept": "application/json"
        }
      }
    }
  ]
}
```
