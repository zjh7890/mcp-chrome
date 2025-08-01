import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import { CustomToolsConfig } from './types/custom-tools';

/**
 * Get storage statistics
 */
export async function handleGetStorageStats(): Promise<{
  success: boolean;
  stats?: any;
  error?: string;
}> {
  try {
    // Get ContentIndexer statistics
    const { getGlobalContentIndexer } = await import('@/utils/content-indexer');
    const contentIndexer = getGlobalContentIndexer();

    // Note: Semantic engine initialization is now user-controlled
    // ContentIndexer will be initialized when user manually triggers semantic engine initialization

    // Get statistics
    const stats = contentIndexer.getStats();

    return {
      success: true,
      stats: {
        indexedPages: stats.indexedPages || 0,
        totalDocuments: stats.totalDocuments || 0,
        totalTabs: stats.totalTabs || 0,
        indexSize: stats.indexSize || 0,
        isInitialized: stats.isInitialized || false,
        semanticEngineReady: stats.semanticEngineReady || false,
        semanticEngineInitializing: stats.semanticEngineInitializing || false,
      },
    };
  } catch (error: any) {
    console.error('Background: Failed to get storage stats:', error);
    return {
      success: false,
      error: error.message,
      stats: {
        indexedPages: 0,
        totalDocuments: 0,
        totalTabs: 0,
        indexSize: 0,
        isInitialized: false,
        semanticEngineReady: false,
        semanticEngineInitializing: false,
      },
    };
  }
}

/**
 * Clear all data
 */
export async function handleClearAllData(): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Clear all ContentIndexer indexes
    try {
      const { getGlobalContentIndexer } = await import('@/utils/content-indexer');
      const contentIndexer = getGlobalContentIndexer();

      await contentIndexer.clearAllIndexes();
      console.log('Storage: ContentIndexer indexes cleared successfully');
    } catch (indexerError) {
      console.warn('Background: Failed to clear ContentIndexer indexes:', indexerError);
      // Continue with other cleanup operations
    }

    // 2. Clear all VectorDatabase data
    try {
      const { clearAllVectorData } = await import('@/utils/vector-database');
      await clearAllVectorData();
      console.log('Storage: Vector database data cleared successfully');
    } catch (vectorError) {
      console.warn('Background: Failed to clear vector data:', vectorError);
      // Continue with other cleanup operations
    }

    // 3. Clear related data in chrome.storage (preserve model preferences)
    try {
      const keysToRemove = ['vectorDatabaseStats', 'lastCleanupTime', 'contentIndexerStats'];
      await chrome.storage.local.remove(keysToRemove);
      console.log('Storage: Chrome storage data cleared successfully');
    } catch (storageError) {
      console.warn('Background: Failed to clear chrome storage data:', storageError);
    }

    return { success: true };
  } catch (error: any) {
    console.error('Background: Failed to clear all data:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 获取自定义工具配置
 */
export async function handleGetCustomToolsConfig(): Promise<{
  success: boolean;
  config?: CustomToolsConfig;
  error?: string;
}> {
  try {
    const result = await chrome.storage.local.get(['custom_tools_config']);
    const config = result.custom_tools_config || { customTools: [] };

    return {
      success: true,
      config,
    };
  } catch (error: any) {
    console.error('Background: Failed to get custom tools config:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * 保存自定义工具配置
 */
export async function handleSaveCustomToolsConfig(config: CustomToolsConfig): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    console.log('Background: 开始保存自定义工具配置:', config);
    await chrome.storage.local.set({ custom_tools_config: config });
    console.log('Background: 自定义工具配置保存成功');

    return {
      success: true,
    };
  } catch (error: any) {
    console.error('Background: 保存自定义工具配置失败:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Initialize storage manager module message listeners
 */
export const initStorageManagerListener = () => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === BACKGROUND_MESSAGE_TYPES.GET_STORAGE_STATS) {
      handleGetStorageStats()
        .then((result: { success: boolean; stats?: any; error?: string }) => sendResponse(result))
        .catch((error: any) => sendResponse({ success: false, error: error.message }));
      return true;
    } else if (message.type === BACKGROUND_MESSAGE_TYPES.CLEAR_ALL_DATA) {
      handleClearAllData()
        .then((result: { success: boolean; error?: string }) => sendResponse(result))
        .catch((error: any) => sendResponse({ success: false, error: error.message }));
      return true;
    } else if (message.type === BACKGROUND_MESSAGE_TYPES.GET_CUSTOM_TOOLS_CONFIG) {
      handleGetCustomToolsConfig()
        .then((result: { success: boolean; config?: CustomToolsConfig; error?: string }) =>
          sendResponse(result),
        )
        .catch((error: any) => sendResponse({ success: false, error: error.message }));
      return true;
    } else if (message.type === BACKGROUND_MESSAGE_TYPES.SAVE_CUSTOM_TOOLS_CONFIG) {
      handleSaveCustomToolsConfig(message.config)
        .then((result: { success: boolean; error?: string }) => sendResponse(result))
        .catch((error: any) => sendResponse({ success: false, error: error.message }));
      return true;
    }
  });
};
