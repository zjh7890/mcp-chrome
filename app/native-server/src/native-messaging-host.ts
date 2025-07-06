import { stdin, stdout } from 'process';
import { Server } from './server';
import { v4 as uuidv4 } from 'uuid';
import { NativeMessageType } from 'chrome-mcp-shared';
import { TIMEOUTS } from './constant';
import { logger } from './util/logger';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeoutId: NodeJS.Timeout;
}

export class NativeMessagingHost {
  private associatedServer: Server | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();

  public setServer(serverInstance: Server): void {
    this.associatedServer = serverInstance;
    logger.info('Native messaging host: Server instance set');
  }

  // add message handler to wait for start server
  public start(): void {
    try {
      logger.info('Native messaging host: Starting message handling');
      logger.info(`Native messaging host: Log file location: ${logger.getLogFile()}`);
      this.setupMessageHandling();
    } catch (error: any) {
      logger.error(`Native messaging host: Failed to start - ${error.message}`);
      process.exit(1);
    }
  }

  private setupMessageHandling(): void {
    let buffer = Buffer.alloc(0);
    let expectedLength = -1;

    logger.info('Native messaging host: Setting up message handling');

    stdin.on('readable', () => {
      let chunk;
      while ((chunk = stdin.read()) !== null) {
        buffer = Buffer.concat([buffer, chunk]);
        logger.debug(
          `Native messaging host: Received chunk of ${chunk.length} bytes, total buffer: ${buffer.length} bytes`,
        );

        if (expectedLength === -1 && buffer.length >= 4) {
          expectedLength = buffer.readUInt32LE(0);
          buffer = buffer.slice(4);
          logger.debug(`Native messaging host: Expected message length: ${expectedLength} bytes`);
        }

        if (expectedLength !== -1 && buffer.length >= expectedLength) {
          const messageBuffer = buffer.slice(0, expectedLength);
          buffer = buffer.slice(expectedLength);

          try {
            const message = JSON.parse(messageBuffer.toString());
            logger.info(`Native messaging host: Received message: ${JSON.stringify(message)}`);
            this.handleMessage(message);
          } catch (error: any) {
            logger.error(`Native messaging host: Failed to parse message - ${error.message}`);
            logger.error(`Native messaging host: Raw message buffer: ${messageBuffer.toString()}`);
            this.sendError(`Failed to parse message: ${error.message}`);
          }
          expectedLength = -1; // reset to get next data
        }
      }
    });

    stdin.on('end', () => {
      logger.info('Native messaging host: stdin ended, Chrome extension disconnected');

      // If server is running, don't exit immediately
      // Let the server continue running for MCP clients
      if (this.associatedServer && this.associatedServer.isRunning) {
        logger.info(
          'Native messaging host: Server is running, keeping process alive for MCP clients',
        );
        logger.info('Native messaging host: HTTP server available at http://127.0.0.1:12306/mcp');

        // Clear any pending requests since extension is disconnected
        this.pendingRequests.forEach((pending, requestId) => {
          logger.debug(
            `Native messaging host: Rejecting pending request ${requestId} due to extension disconnect`,
          );
          clearTimeout(pending.timeoutId);
          pending.reject(new Error('Chrome extension disconnected'));
        });
        this.pendingRequests.clear();
      } else {
        logger.info('Native messaging host: No server running, cleaning up');
        this.cleanup();
      }
    });

    stdin.on('error', (error) => {
      logger.error(`Native messaging host: stdin error - ${error.message}`);

      // Similar logic for stdin errors
      if (this.associatedServer && this.associatedServer.isRunning) {
        logger.info(
          'Native messaging host: Server is running, keeping process alive despite stdin error',
        );
      } else {
        this.cleanup();
      }
    });
  }

  private async handleMessage(message: any): Promise<void> {
    logger.debug(`Native messaging host: Handling message type: ${message.type}`);

    if (!message || typeof message !== 'object') {
      logger.error('Native messaging host: Invalid message format - not an object');
      this.sendError('Invalid message format');
      return;
    }

    if (message.responseToRequestId) {
      const requestId = message.responseToRequestId;
      const pending = this.pendingRequests.get(requestId);
      logger.debug(`Native messaging host: Received response for request ${requestId}`);

      if (pending) {
        clearTimeout(pending.timeoutId);
        if (message.error) {
          logger.error(`Native messaging host: Request ${requestId} failed - ${message.error}`);
          pending.reject(new Error(message.error));
        } else {
          logger.debug(`Native messaging host: Request ${requestId} succeeded`);
          pending.resolve(message.payload);
        }
        this.pendingRequests.delete(requestId);
      } else {
        logger.warn(`Native messaging host: No pending request found for ID ${requestId}`);
      }
      return;
    }

    // Handle directive messages from Chrome
    try {
      switch (message.type) {
        case NativeMessageType.START:
          logger.info(
            `Native messaging host: Received START command with port ${message.payload?.port || 3000}`,
          );
          await this.startServer(message.payload?.port || 3000);
          break;
        case NativeMessageType.STOP:
          logger.info('Native messaging host: Received STOP command');
          await this.stopServer();
          break;
        // Keep ping/pong for simple liveness detection, but this differs from request-response pattern
        case 'ping_from_extension':
          logger.debug('Native messaging host: Received ping from extension');
          this.sendMessage({ type: 'pong_to_extension' });
          break;
        default:
          // Double check when message type is not supported
          if (!message.responseToRequestId) {
            logger.error(
              `Native messaging host: Unknown message type: ${message.type || 'no type'}`,
            );
            this.sendError(
              `Unknown message type or non-response message: ${message.type || 'no type'}`,
            );
          }
      }
    } catch (error: any) {
      logger.error(`Native messaging host: Failed to handle directive message - ${error.message}`);
      this.sendError(`Failed to handle directive message: ${error.message}`);
    }
  }

  /**
   * Send request to Chrome and wait for response
   * @param messagePayload Data to send to Chrome
   * @param timeoutMs Timeout for waiting response (milliseconds)
   * @returns Promise, resolves to Chrome's returned payload on success, rejects on failure
   */
  public sendRequestToExtensionAndWait(
    messagePayload: any,
    messageType: string = 'request_data',
    timeoutMs: number = TIMEOUTS.DEFAULT_REQUEST_TIMEOUT,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = uuidv4(); // Generate unique request ID
      logger.debug(`Native messaging host: Sending request ${requestId} to extension`);
      logger.debug(`Native messaging host: Request payload: ${JSON.stringify(messagePayload)}`);

      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId); // Remove from Map after timeout
        logger.error(`Native messaging host: Request ${requestId} timed out after ${timeoutMs}ms`);
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Store request's resolve/reject functions and timeout ID
      this.pendingRequests.set(requestId, { resolve, reject, timeoutId });

      // Send message with requestId to Chrome
      this.sendMessage({
        type: messageType, // Define a request type, e.g. 'request_data'
        payload: messagePayload,
        requestId: requestId, // <--- Key: include request ID
      });
    });
  }

  /**
   * Start Fastify server (now accepts Server instance)
   */
  private async startServer(port: number): Promise<void> {
    logger.info(`Native messaging host: Starting server on port ${port}`);

    if (!this.associatedServer) {
      logger.error('Native messaging host: Server instance not set');
      this.sendError('Internal error: server instance not set');
      return;
    }
    try {
      if (this.associatedServer.isRunning) {
        logger.warn('Native messaging host: Server is already running');
        this.sendMessage({
          type: NativeMessageType.ERROR,
          payload: { message: 'Server is already running' },
        });
        return;
      }

      await this.associatedServer.start(port, this);
      logger.info(`Native messaging host: Server started successfully on port ${port}`);

      this.sendMessage({
        type: NativeMessageType.SERVER_STARTED,
        payload: { port },
      });
    } catch (error: any) {
      logger.error(`Native messaging host: Failed to start server - ${error.message}`);
      this.sendError(`Failed to start server: ${error.message}`);
    }
  }

  /**
   * Stop Fastify server
   */
  private async stopServer(): Promise<void> {
    logger.info('Native messaging host: Stopping server');

    if (!this.associatedServer) {
      logger.error('Native messaging host: Server instance not set');
      this.sendError('Internal error: server instance not set');
      return;
    }
    try {
      // Check status through associatedServer
      if (!this.associatedServer.isRunning) {
        logger.warn('Native messaging host: Server is not running');
        this.sendMessage({
          type: NativeMessageType.ERROR,
          payload: { message: 'Server is not running' },
        });
        return;
      }

      await this.associatedServer.stop();
      logger.info('Native messaging host: Server stopped successfully');
      // this.serverStarted = false; // Server should update its own status after successful stop

      this.sendMessage({ type: NativeMessageType.SERVER_STOPPED }); // Distinguish from previous 'stopped'
    } catch (error: any) {
      logger.error(`Native messaging host: Failed to stop server - ${error.message}`);
      this.sendError(`Failed to stop server: ${error.message}`);
    }
  }

  /**
   * Send message to Chrome extension
   */
  public sendMessage(message: any): void {
    try {
      const messageString = JSON.stringify(message);
      const messageBuffer = Buffer.from(messageString);
      const headerBuffer = Buffer.alloc(4);
      headerBuffer.writeUInt32LE(messageBuffer.length, 0);

      logger.debug(`Native messaging host: Sending message to extension: ${messageString}`);
      logger.debug(`Native messaging host: Message length: ${messageBuffer.length} bytes`);

      // Ensure atomic write
      stdout.write(Buffer.concat([headerBuffer, messageBuffer]), (err) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
            logger.warn(
              `Native messaging host: Chrome extension disconnected (EPIPE) - ${err.message}`,
            );

            // If server is running, don't exit immediately
            if (this.associatedServer && this.associatedServer.isRunning) {
              logger.info(
                'Native messaging host: Server is running, keeping process alive despite EPIPE',
              );

              // Clear pending requests since extension is disconnected
              this.pendingRequests.forEach((pending, requestId) => {
                logger.debug(
                  `Native messaging host: Rejecting pending request ${requestId} due to EPIPE`,
                );
                clearTimeout(pending.timeoutId);
                pending.reject(new Error('Chrome extension disconnected (EPIPE)'));
              });
              this.pendingRequests.clear();
            } else {
              logger.info(
                'Native messaging host: Initiating graceful shutdown due to extension disconnect',
              );
              this.cleanup();
            }
          } else {
            logger.error(
              `Native messaging host: Failed to write message to stdout - ${err.message}`,
            );
          }
        } else {
          logger.debug('Native messaging host: Message sent successfully to extension');
        }
      });
    } catch (error: any) {
      logger.error(`Native messaging host: Failed to prepare message - ${error.message}`);
      // Catch JSON.stringify or Buffer operation errors
      // If preparation stage fails, associated request may never be sent
      // Need to consider whether to reject corresponding Promise (if called within sendRequestToExtensionAndWait)
    }
  }

  /**
   * Send error message to Chrome extension (mainly for sending non-request-response type errors)
   */
  private sendError(errorMessage: string): void {
    logger.error(`Native messaging host: Sending error to extension - ${errorMessage}`);
    this.sendMessage({
      type: NativeMessageType.ERROR_FROM_NATIVE_HOST, // Use more explicit type
      payload: { message: errorMessage },
    });
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    logger.info('Native messaging host: Cleaning up resources');
    logger.info(`Native messaging host: ${this.pendingRequests.size} pending requests to reject`);

    // Reject all pending requests
    this.pendingRequests.forEach((pending, requestId) => {
      logger.debug(`Native messaging host: Rejecting pending request ${requestId}`);
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Native host is shutting down or Chrome disconnected.'));
    });
    this.pendingRequests.clear();

    if (this.associatedServer && this.associatedServer.isRunning) {
      logger.info('Native messaging host: Stopping server during cleanup');
      this.associatedServer
        .stop()
        .then(() => {
          logger.info('Native messaging host: Server stopped, exiting process');
          process.exit(0);
        })
        .catch((error) => {
          logger.error(
            `Native messaging host: Failed to stop server during cleanup - ${error.message}`,
          );
          process.exit(1);
        });
    } else {
      logger.info('Native messaging host: No server to stop, exiting process');
      process.exit(0);
    }
  }
}

const nativeMessagingHostInstance = new NativeMessagingHost();
export default nativeMessagingHostInstance;
