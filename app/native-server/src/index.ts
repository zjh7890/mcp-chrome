#!/usr/bin/env node
import serverInstance from './server';
import nativeMessagingHostInstance from './native-messaging-host';
import { logger } from './util/logger';

logger.info('=== Chrome MCP Server Native Host Starting ===');
logger.info(`Process ID: ${process.pid}`);
logger.info(`Node.js version: ${process.version}`);
logger.info(`Platform: ${process.platform}`);
logger.info(`Architecture: ${process.arch}`);
logger.info(`Working directory: ${process.cwd()}`);
logger.info(`Command line args: ${process.argv.join(' ')}`);

try {
  logger.info('Setting up server and native messaging host instances');
  serverInstance.setNativeHost(nativeMessagingHostInstance); // Server needs setNativeHost method
  nativeMessagingHostInstance.setServer(serverInstance); // NativeHost needs setServer method

  logger.info('Starting native messaging host');
  nativeMessagingHostInstance.start();
} catch (error: any) {
  logger.error(`Failed to start native messaging host: ${error.message}`);
  logger.error(`Stack trace: ${error.stack}`);
  process.exit(1);
}

process.on('error', (error) => {
  logger.error(`Process error: ${error.message}`);
  process.exit(1);
});

// Handle process signals and uncaught exceptions
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('exit', (code) => {
  logger.info(`Process exiting with code: ${code}`);
});

process.on('uncaughtException', (error) => {
  // Handle EPIPE errors gracefully (Chrome extension disconnect)
  if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
    logger.warn(`Chrome extension disconnected (EPIPE): ${error.message}`);
    logger.info('Shutting down gracefully due to extension disconnect');
    process.exit(0);
  } else {
    logger.error(`Uncaught exception: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${reason}`);
  // Don't exit immediately, let the program continue running
});
