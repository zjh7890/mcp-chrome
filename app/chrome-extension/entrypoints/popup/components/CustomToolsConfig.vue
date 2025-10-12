<template>
  <div class="custom-tools-config">
    <p class="section-description">配置自定义 API 工具，支持动态添加和管理</p>

    <div class="config-container">
      <div class="config-editor">
        <label for="config-textarea">工具配置 (JSON 格式)</label>
        <textarea
          id="config-textarea"
          v-model="configText"
          placeholder="请输入自定义工具配置..."
          rows="15"
          class="config-textarea"
          :class="{ 'config-error': !isValidConfig && configText.trim() !== '' }"
        />

        <!-- 实时验证状态显示 -->
        <div v-if="configText.trim() !== ''" class="validation-status">
          <div v-if="isValidConfig" class="validation-success"> ✓ JSON 格式正确 </div>
          <div v-else class="validation-error"> ✗ {{ validationError }} </div>
        </div>

        <div class="config-actions">
          <button @click="loadConfig" class="btn btn-secondary">加载配置</button>
          <button
            @click="saveConfig"
            class="btn btn-primary"
            :disabled="saving || (!isValidConfig && configText.trim() !== '')"
          >
            {{ saving ? '保存中...' : '保存配置' }}
          </button>
          <button @click="resetConfig" class="btn btn-warning">重置</button>
        </div>
      </div>

      <div class="config-preview">
        <h4>配置预览</h4>
        <div v-if="parsedConfig.customTools.length > 0" class="tools-list">
          <div v-for="tool in parsedConfig.customTools" :key="tool.name" class="tool-item">
            <div class="tool-header">
              <span class="tool-name">{{ tool.name }}</span>
              <span class="tool-badge">自定义</span>
            </div>
            <div class="tool-description">{{ tool.description }}</div>
            <div class="tool-params" v-if="tool.inputSchema.properties">
              <span class="params-label">参数:</span>
              <span class="params-list">
                {{ Object.keys(tool.inputSchema.properties).join(', ') }}
              </span>
            </div>
          </div>
        </div>
        <div v-else class="no-tools">
          <p>暂无自定义工具配置</p>
        </div>
      </div>
    </div>

    <div class="config-help">
      <details>
        <summary>配置示例</summary>
        <div class="config-example-container">
          <div class="config-example-header">
            <span>JSON 配置示例</span>
            <button @click="copyExample" class="copy-btn" :class="{ copied: exampleCopied }">
              <span v-if="!exampleCopied">📋 复制</span>
              <span v-else>✅ 已复制</span>
            </button>
          </div>
          <pre class="config-example">{{ configExample }}</pre>
        </div>
      </details>
    </div>

    <div v-if="message" class="message" :class="messageType">
      {{ message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, toRef } from 'vue';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

interface WebRequestListenerConfig {
  id: string;
  enabled: boolean;
  urlPattern: string;
  headerName: string;
  storageKey: string;
}

interface CustomToolConfig {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  script?: string[]; // JSONata 脚本（行数组）
}

interface CustomToolsConfigData {
  webRequestListeners?: WebRequestListenerConfig[];
  customTools: CustomToolConfig[];
}

const configText = ref('');
const saving = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error' | 'info'>('info');

// 实时验证相关状态
const validationError = ref('');
const isValidConfig = ref(true);

// 复制示例状态
const exampleCopied = ref(false);

const configExample = `{
  "webRequestListeners": [
    {
      "id": "api_listener",
      "enabled": true,
      "urlPattern": "*://api.example.com/*",
      "headerName": "authorization",
      "storageKey": "api_token"
    }
  ],
  "customTools": [
    {
      "name": "get_weather",
      "description": "获取城市天气信息",
      "inputSchema": {
        "type": "object",
        "properties": {
          "city": {"type": "string"},
          "units": {"type": "string", "default": "metric"}
        },
        "required": ["city"]
      },
      "script": [
        "(",
        "  $u := 'https://api.example.com/weather?q=' & $ARGS.city & '&units=' & $ARGS.units;",
        "  $resp := $fetch($u, { 'method': 'GET', 'headers': { 'authorization': $LISTENER_DATA.api_token } });",
        "  $data := $body($resp, 'json');",
        "  $data",
        ")"
      ]
    }
  ]
}`;

// 实时验证配置
const configValidation = computed(() => {
  const text = configText.value.trim();

  // 空配置是有效的
  if (text === '') {
    return {
      isValid: true,
      error: '',
      config: { customTools: [] },
    };
  }

  return validateJsonConfig(text);
});

// 同步验证状态到响应式变量
const updateValidationState = () => {
  const validation = configValidation.value;
  isValidConfig.value = validation.isValid;
  validationError.value = validation.error || '';
};

// 监听配置文本变化，实时更新验证状态
watch(
  configText,
  () => {
    updateValidationState();
  },
  { immediate: true },
);

const parsedConfig = computed<CustomToolsConfigData>(() => {
  const validation = configValidation.value;
  return validation.isValid ? validation.config || { customTools: [] } : { customTools: [] };
});

// 认证提示已移除：脚本内部自行使用 $LISTENER_DATA

const showMessage = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
  message.value = msg;
  messageType.value = type;
  setTimeout(() => {
    message.value = '';
  }, 3000);
};

const loadConfig = async () => {
  try {
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.GET_CUSTOM_TOOLS_CONFIG,
    });

    // 检查响应是否为 undefined
    if (!response) {
      console.error('响应为 undefined，可能是后台脚本没有正确响应');
      showMessage('加载配置失败: 后台脚本无响应', 'error');
      return;
    }

    if (response.success) {
      // 如果没有自定义工具配置，显示空白而不是空对象
      if (
        response.config &&
        response.config.customTools &&
        response.config.customTools.length > 0
      ) {
        configText.value = JSON.stringify(response.config, null, 2);
        showMessage('配置加载成功', 'success');
      } else {
        configText.value = '';
        showMessage('暂无保存的配置', 'info');
      }
    } else {
      console.error('加载失败:', response.error);
      showMessage(`加载配置失败: ${response.error}`, 'error');
    }
  } catch (error) {
    console.error('加载配置时发生错误:', error);
    showMessage(`加载配置失败: ${error}`, 'error');
  }
};

/**
 * 验证 JSON 格式并提供详细的错误信息
 */
const validateJsonConfig = (
  jsonText: string,
): { isValid: boolean; config?: any; error?: string } => {
  try {
    // 检查基本 JSON 语法
    const config = JSON.parse(jsonText);

    // 检查配置结构
    if (typeof config !== 'object' || config === null) {
      return {
        isValid: false,
        error: 'JSON 格式错误：配置必须是一个对象',
      };
    }

    // 检查 customTools 字段
    if (!Object.prototype.hasOwnProperty.call(config, 'customTools')) {
      return {
        isValid: false,
        error: '配置格式错误：缺少必需的 "customTools" 字段',
      };
    }

    if (!Array.isArray(config.customTools)) {
      return {
        isValid: false,
        error: '配置格式错误："customTools" 必须是数组',
      };
    }

    // 验证 customTools 中每个工具的结构
    for (let i = 0; i < config.customTools.length; i++) {
      const tool = config.customTools[i];
      const toolIndex = i + 1;

      if (typeof tool !== 'object' || tool === null) {
        return {
          isValid: false,
          error: `第 ${toolIndex} 个工具配置错误：必须是一个对象`,
        };
      }

      // 检查必需字段（根据类型区分）
      const baseRequired = ['name', 'description', 'inputSchema'];
      for (const field of baseRequired) {
        if (!Object.prototype.hasOwnProperty.call(tool, field)) {
          return {
            isValid: false,
            error: `第 ${toolIndex} 个工具配置错误：缺少必需字段 "${field}"`,
          };
        }
      }

      // 检查 name 字段
      if (typeof tool.name !== 'string' || tool.name.trim() === '') {
        return {
          isValid: false,
          error: `第 ${toolIndex} 个工具配置错误："name" 必须是非空字符串`,
        };
      }

      // 检查 description 字段
      if (typeof tool.description !== 'string') {
        return {
          isValid: false,
          error: `第 ${toolIndex} 个工具配置错误："description" 必须是字符串`,
        };
      }

      // 校验脚本字段 script（字符串数组，非空）
      if (!Array.isArray(tool.script) || tool.script.length === 0) {
        return {
          isValid: false,
          error: `第 ${toolIndex} 个工具配置错误：缺少非空的 "script" 字段（字符串数组）`,
        };
      }

      // 检查 inputSchema 字段
      if (typeof tool.inputSchema !== 'object' || tool.inputSchema === null) {
        return {
          isValid: false,
          error: `第 ${toolIndex} 个工具配置错误："inputSchema" 必须是对象`,
        };
      }

      if (tool.inputSchema.type !== 'object') {
        return {
          isValid: false,
          error: `第 ${toolIndex} 个工具配置错误："inputSchema.type" 必须是 "object"`,
        };
      }
    }

    // 检查工具名称是否重复
    const toolNames = config.customTools.map((tool: any) => tool.name);
    const duplicates = toolNames.filter(
      (name: string, index: number) => toolNames.indexOf(name) !== index,
    );
    if (duplicates.length > 0) {
      return {
        isValid: false,
        error: `工具名称重复：${duplicates.join(', ')}`,
      };
    }

    return {
      isValid: true,
      config,
    };
  } catch (error: any) {
    // 处理 JSON 语法错误
    let errorMessage = 'JSON 格式错误：';

    if (error.message.includes('Unexpected token')) {
      const match = error.message.match(/Unexpected token (.+) in JSON at position (\d+)/);
      if (match) {
        const [, token, position] = match;
        errorMessage += `在位置 ${position} 发现意外的字符 "${token}"`;
      } else {
        errorMessage += '存在语法错误，请检查括号、引号和逗号是否正确';
      }
    } else if (error.message.includes('Unexpected end')) {
      errorMessage += '意外结束，可能缺少结束括号或引号';
    } else if (error.message.includes('Unexpected string')) {
      errorMessage += '字符串格式错误，请检查引号是否正确';
    } else {
      errorMessage += error.message;
    }

    return {
      isValid: false,
      error: errorMessage,
    };
  }
};

const saveConfig = async () => {
  try {
    // 如果输入为空，保存空配置
    let config;
    if (configText.value.trim() === '') {
      config = { customTools: [] };
      console.info('输入为空，保存空配置');
    } else {
      // 使用改进的 JSON 格式验证
      const validation = validateJsonConfig(configText.value);

      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      config = validation.config;
    }

    saving.value = true;
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.SAVE_CUSTOM_TOOLS_CONFIG,
      config,
    });

    // 检查响应是否为 undefined
    if (!response) {
      console.error('响应为 undefined，可能是后台脚本没有正确响应');
      showMessage('保存配置失败: 后台脚本无响应', 'error');
      return;
    }

    if (response.success) {
      showMessage('配置保存成功', 'success');
    } else {
      console.error('保存失败:', response.error);
      showMessage(`保存配置失败: ${response.error}`, 'error');
    }
  } catch (error) {
    console.error('保存配置时发生错误:', error);
    showMessage(`保存配置失败: ${error}`, 'error');
  } finally {
    saving.value = false;
  }
};

const resetConfig = () => {
  configText.value = JSON.stringify({ customTools: [] }, null, 2);
  showMessage('配置已重置', 'info');
};

const copyExample = async () => {
  try {
    await navigator.clipboard.writeText(configExample);
    exampleCopied.value = true;
    showMessage('配置示例已复制到剪贴板', 'success');

    // 2秒后重置复制状态
    setTimeout(() => {
      exampleCopied.value = false;
    }, 2000);
  } catch (error) {
    console.error('复制失败:', error);
    showMessage('复制失败，请手动选择并复制', 'error');
  }
};

onMounted(() => {
  loadConfig();
});
</script>

<style scoped>
.custom-tools-config {
  max-width: 100%;
}

.section-header {
  margin-bottom: 20px;
}

.section-header h3 {
  margin: 0 0 8px 0;
  color: var(--primary-color);
  font-size: 18px;
}

.section-description {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.config-container {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
}

.config-editor {
  flex: 1;
}

.config-editor label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--text-primary);
}

.config-textarea {
  width: 100%;
  min-height: 300px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.4;
  resize: vertical;
  background: #ffffff;
  color: var(--text-primary);
  transition: all 0.2s ease;
}

.config-textarea:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  background: #ffffff;
}

.config-textarea.config-error {
  border-color: #ef4444;
  background-color: #fef2f2;
}

.config-textarea.config-error:focus {
  border-color: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.1);
}

.validation-status {
  margin-top: 8px;
  font-size: 14px;
}

.validation-success {
  color: #10b981;
  display: flex;
  align-items: center;
  gap: 4px;
}

.validation-error {
  color: #ef4444;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  line-height: 1.4;
}

.config-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-dark);
}

.btn-primary:disabled {
  background: var(--border-color);
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
  background: var(--bg-tertiary);
}

.btn-warning {
  background: #f59e0b;
  color: white;
}

.btn-warning:hover {
  background: #d97706;
}

.config-preview {
  flex: 1;
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 16px;
  max-height: 400px;
  overflow-y: auto;
}

.config-preview h4 {
  margin: 0 0 12px 0;
  color: var(--text-primary);
  font-size: 16px;
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-item {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 12px;
}

.tool-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.tool-name {
  font-weight: 500;
  color: var(--text-primary);
}

.tool-badge {
  background: var(--primary-color);
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
}

.tool-description {
  color: var(--text-secondary);
  font-size: 14px;
  margin-bottom: 8px;
}

.tool-params,
.tool-auth {
  font-size: 12px;
  color: var(--text-secondary);
}

.params-label,
.auth-label {
  font-weight: 500;
  color: var(--text-primary);
}

.no-tools {
  text-align: center;
  color: var(--text-secondary);
  padding: 40px 20px;
}

.config-help {
  margin-bottom: 20px;
}

.config-help details {
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 16px;
}

.config-help summary {
  cursor: pointer;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.config-example-container {
  margin-top: 12px;
}

.config-example-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding: 8px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px 4px 0 0;
  border-bottom: none;
}

.config-example-header span {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.copy-btn {
  padding: 4px 12px;
  background: var(--primary-color);
  color: white !important;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 4px;
}

.copy-btn:hover {
  background: var(--primary-dark);
  transform: translateY(-1px);
  color: white !important;
}

.copy-btn.copied {
  background: #10b981;
  color: white !important;
}

.copy-btn.copied:hover {
  background: #059669;
  color: white !important;
}

.copy-btn span {
  color: inherit !important;
}

.config-example {
  background: #ffffff;
  border: 1px solid var(--border-color);
  border-radius: 0 0 4px 4px;
  border-top: none;
  padding: 12px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.4;
  overflow-x: auto;
  color: #1f2937;
  margin: 0;
}

.message {
  padding: 12px;
  border-radius: 4px;
  font-size: 14px;
  margin-top: 16px;
}

.message.success {
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}

.message.error {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.message.info {
  background: #dbeafe;
  color: #1e40af;
  border: 1px solid #93c5fd;
}

/* 深色主题适配 */
@media (prefers-color-scheme: dark) {
  .config-textarea {
    background: #1f2937;
    color: #f9fafb;
  }

  .config-textarea:focus {
    background: #1f2937;
  }

  .config-textarea.config-error {
    background-color: #451a03;
  }

  .config-example {
    background: #1f2937;
    color: #f9fafb;
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .config-container {
    flex-direction: column;
  }

  .config-textarea {
    min-height: 200px;
  }

  .config-preview {
    max-height: 300px;
  }
}
</style>
