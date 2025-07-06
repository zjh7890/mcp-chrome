<template>
  <div class="custom-tools-config">
    <div class="section-header">
      <h3>自定义工具配置</h3>
      <p class="section-description">配置自定义 API 工具，支持动态添加和管理</p>
    </div>

    <div class="config-container">
      <div class="config-editor">
        <label for="config-textarea">工具配置 (JSON 格式)</label>
        <textarea
          id="config-textarea"
          v-model="configText"
          placeholder="请输入自定义工具配置..."
          rows="15"
          class="config-textarea"
        />
        <div class="config-actions">
          <button @click="loadConfig" class="btn btn-secondary">加载配置</button>
          <button @click="saveConfig" class="btn btn-primary" :disabled="saving">
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
            <div class="tool-auth" v-if="tool.webRequestListener?.enabled">
              <span class="auth-label">自动认证:</span>
              <span class="auth-info">{{ tool.webRequestListener.storageKey }}</span>
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
        <pre class="config-example">{{ configExample }}</pre>
      </details>
    </div>

    <div v-if="message" class="message" :class="messageType">
      {{ message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

interface CustomToolConfig {
  name: string;
  description: string;
  fetchCode: string;
  webRequestListener?: {
    enabled: boolean;
    urlPattern: string;
    headerName: string;
    storageKey: string;
  };
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

interface CustomToolsConfigData {
  customTools: CustomToolConfig[];
}

const configText = ref('');
const saving = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error' | 'info'>('info');

const configExample = `{
  "customTools": [
    {
      "name": "task_list",
      "description": "获取任务列表",
      "fetchCode": "fetch(\\"https://api.example.com/tasks?page=\${page}&status=\${status}\\", {\\n  \\"headers\\": {\\n    \\"authorization\\": \\"\${auth_token}\\",\\n    \\"content-type\\": \\"application/json\\"\\n  },\\n  \\"method\\": \\"GET\\"\\n})",
      "webRequestListener": {
        "enabled": true,
        "urlPattern": "*://api.example.com/*",
        "headerName": "authorization",
        "storageKey": "auth_token"
      },
      "inputSchema": {
        "type": "object",
        "properties": {
          "page": {
            "type": "number",
            "description": "页码，从1开始"
          },
          "status": {
            "type": "string",
            "description": "任务状态"
          }
        },
        "required": ["page"]
      }
    }
  ]
}`;

const parsedConfig = computed<CustomToolsConfigData>(() => {
  try {
    const parsed = JSON.parse(configText.value || '{"customTools": []}');
    return parsed;
  } catch {
    return { customTools: [] };
  }
});

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

    if (response.success) {
      configText.value = JSON.stringify(response.config, null, 2);
      showMessage('配置加载成功', 'success');
    } else {
      showMessage(`加载配置失败: ${response.error}`, 'error');
    }
  } catch (error) {
    showMessage(`加载配置失败: ${error}`, 'error');
  }
};

const saveConfig = async () => {
  try {
    // 验证 JSON 格式
    const config = JSON.parse(configText.value);

    if (!config.customTools || !Array.isArray(config.customTools)) {
      throw new Error('配置格式错误：customTools 必须是数组');
    }

    saving.value = true;
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.SAVE_CUSTOM_TOOLS_CONFIG,
      config,
    });

    if (response.success) {
      showMessage('配置保存成功', 'success');
    } else {
      showMessage(`保存配置失败: ${response.error}`, 'error');
    }
  } catch (error) {
    showMessage(`保存配置失败: ${error}`, 'error');
  } finally {
    saving.value = false;
  }
};

const resetConfig = () => {
  configText.value = JSON.stringify({ customTools: [] }, null, 2);
  showMessage('配置已重置', 'info');
};

onMounted(() => {
  loadConfig();
});
</script>

<style scoped>
.custom-tools-config {
  padding: 16px;
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
  background: var(--background-secondary);
  color: var(--text-primary);
}

.config-textarea:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
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
  background: var(--primary-hover);
}

.btn-primary:disabled {
  background: var(--border-color);
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--background-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
  background: var(--background-hover);
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
  background: var(--background-secondary);
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
  background: var(--background-primary);
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
  background: var(--background-secondary);
  border-radius: 6px;
  padding: 16px;
}

.config-help summary {
  cursor: pointer;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.config-example {
  background: var(--background-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 12px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.4;
  overflow-x: auto;
  color: var(--text-primary);
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
