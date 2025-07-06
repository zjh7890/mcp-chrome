import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import {
  NATIVE_SERVER_PORT,
  TIMEOUTS,
  SERVER_CONFIG,
  HTTP_STATUS,
  ERROR_MESSAGES,
} from '../constant';
import { NativeMessagingHost } from '../native-messaging-host';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { getMcpServer } from '../mcp/mcp-server';
import { logger } from '../util/logger';

// Define request body type (if data needs to be retrieved from HTTP requests)
interface ExtensionRequestPayload {
  data?: any; // Data you want to pass to the extension
}

export class Server {
  private fastify: FastifyInstance;
  public isRunning = false; // Changed to public or provide a getter
  private nativeHost: NativeMessagingHost | null = null;
  private transportsMap: Map<string, StreamableHTTPServerTransport | SSEServerTransport> =
    new Map();

  constructor() {
    logger.info('Server: Initializing Fastify server');
    this.fastify = Fastify({ logger: SERVER_CONFIG.LOGGER_ENABLED });
    this.setupPlugins();
    this.setupRoutes();
  }
  /**
   * Associate NativeMessagingHost instance
   */
  public setNativeHost(nativeHost: NativeMessagingHost): void {
    this.nativeHost = nativeHost;
    logger.info('Server: Native messaging host instance set');
  }

  private async setupPlugins(): Promise<void> {
    logger.debug('Server: Setting up plugins');
    await this.fastify.register(cors, {
      origin: SERVER_CONFIG.CORS_ORIGIN,
    });
    logger.debug('Server: CORS plugin registered');
  }

  private setupRoutes(): void {
    logger.debug('Server: Setting up routes');

    // for ping
    this.fastify.get(
      '/ask-extension',
      async (request: FastifyRequest<{ Body: ExtensionRequestPayload }>, reply: FastifyReply) => {
        logger.debug('Server: Received /ask-extension request');
        logger.debug(`Server: Request query: ${JSON.stringify(request.query)}`);

        if (!this.nativeHost) {
          logger.error('Server: Native host not available for /ask-extension');
          return reply
            .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.NATIVE_HOST_NOT_AVAILABLE });
        }
        if (!this.isRunning) {
          logger.error('Server: Server not running for /ask-extension');
          return reply
            .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.SERVER_NOT_RUNNING });
        }

        try {
          logger.debug('Server: Sending request to extension via native host');
          // wait from extension message
          const extensionResponse = await this.nativeHost.sendRequestToExtensionAndWait(
            request.query,
            'process_data',
            TIMEOUTS.EXTENSION_REQUEST_TIMEOUT,
          );
          logger.debug(
            `Server: Received response from extension: ${JSON.stringify(extensionResponse)}`,
          );
          return reply.status(HTTP_STATUS.OK).send({ status: 'success', data: extensionResponse });
        } catch (error: any) {
          logger.error(`Server: Error in /ask-extension - ${error.message}`);
          if (error.message.includes('timed out')) {
            return reply
              .status(HTTP_STATUS.GATEWAY_TIMEOUT)
              .send({ status: 'error', message: ERROR_MESSAGES.REQUEST_TIMEOUT });
          } else {
            return reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
              status: 'error',
              message: `Failed to get response from extension: ${error.message}`,
            });
          }
        }
      },
    );

    // Compatible with SSE
    this.fastify.get('/sse', async (_, reply) => {
      logger.debug('Server: Received /sse request');
      try {
        // Set SSE headers
        reply.raw.writeHead(HTTP_STATUS.OK, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        // Create SSE transport
        const transport = new SSEServerTransport('/messages', reply.raw);
        this.transportsMap.set(transport.sessionId, transport);
        logger.debug(`Server: Created SSE transport with session ID: ${transport.sessionId}`);

        reply.raw.on('close', () => {
          logger.debug(`Server: SSE connection closed for session: ${transport.sessionId}`);
          this.transportsMap.delete(transport.sessionId);
        });

        const server = getMcpServer();
        await server.connect(transport);

        // Keep connection open
        reply.raw.write(':\n\n');
      } catch (error: any) {
        logger.error(`Server: Error in /sse - ${error.message}`);
        if (!reply.sent) {
          reply.code(HTTP_STATUS.INTERNAL_SERVER_ERROR).send(ERROR_MESSAGES.INTERNAL_SERVER_ERROR);
        }
      }
    });

    // Compatible with SSE
    this.fastify.post('/messages', async (req, reply) => {
      logger.debug('Server: Received /messages POST request');
      try {
        const { sessionId } = req.query as any;
        const transport = this.transportsMap.get(sessionId) as SSEServerTransport;
        logger.debug(`Server: Looking for transport with session ID: ${sessionId}`);

        if (!sessionId || !transport) {
          logger.error(`Server: No transport found for session ID: ${sessionId}`);
          reply.code(HTTP_STATUS.BAD_REQUEST).send('No transport found for sessionId');
          return;
        }

        await transport.handlePostMessage(req.raw, reply.raw, req.body);
      } catch (error: any) {
        logger.error(`Server: Error in /messages POST - ${error.message}`);
        if (!reply.sent) {
          reply.code(HTTP_STATUS.INTERNAL_SERVER_ERROR).send(ERROR_MESSAGES.INTERNAL_SERVER_ERROR);
        }
      }
    });

    // POST /mcp: Handle client-to-server messages
    this.fastify.post('/mcp', async (request, reply) => {
      logger.debug('Server: Received /mcp POST request');
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      logger.debug(`Server: MCP session ID: ${sessionId}`);

      let transport: StreamableHTTPServerTransport | undefined = this.transportsMap.get(
        sessionId || '',
      ) as StreamableHTTPServerTransport;
      if (transport) {
        logger.debug('Server: Found existing transport for session');
        // transport found, do nothing
      } else if (!sessionId && isInitializeRequest(request.body)) {
        logger.debug('Server: Creating new transport for initialize request');
        const newSessionId = randomUUID(); // Generate session ID
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId, // Use pre-generated ID
          onsessioninitialized: (initializedSessionId) => {
            logger.debug(`Server: Transport session initialized: ${initializedSessionId}`);
            // Ensure transport instance exists and session ID matches
            if (transport && initializedSessionId === newSessionId) {
              this.transportsMap.set(initializedSessionId, transport);
            }
          },
        });

        transport.onclose = () => {
          logger.debug(`Server: Transport closed for session: ${transport?.sessionId}`);
          if (transport?.sessionId && this.transportsMap.get(transport.sessionId)) {
            this.transportsMap.delete(transport.sessionId);
          }
        };
        await getMcpServer().connect(transport);
      } else {
        logger.error('Server: Invalid MCP request - no session ID and not initialize request');
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_MCP_REQUEST });
        return;
      }

      try {
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error: any) {
        logger.error(`Server: Error handling MCP request - ${error.message}`);
        if (!reply.sent) {
          reply
            .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.MCP_REQUEST_PROCESSING_ERROR });
        }
      }
    });

    this.fastify.get('/mcp', async (request, reply) => {
      logger.debug('Server: Received /mcp GET request');
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      const transport = sessionId
        ? (this.transportsMap.get(sessionId) as StreamableHTTPServerTransport)
        : undefined;
      if (!transport) {
        logger.error(`Server: No transport found for MCP GET session: ${sessionId}`);
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_SSE_SESSION });
        return;
      }

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders(); // Ensure headers are sent immediately

      try {
        // transport.handleRequest will take over the response stream
        await transport.handleRequest(request.raw, reply.raw);
        if (!reply.sent) {
          // If transport didn't send anything (unlikely for SSE initial handshake)
          reply.hijack(); // Prevent Fastify from automatically sending response
        }
      } catch (error: any) {
        logger.error(`Server: Error in MCP GET - ${error.message}`);
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      }

      request.socket.on('close', () => {
        logger.debug(`Server: SSE client disconnected for session: ${sessionId}`);
        // transport's onclose should handle its own cleanup
      });
    });

    this.fastify.delete('/mcp', async (request, reply) => {
      logger.debug('Server: Received /mcp DELETE request');
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      const transport = sessionId
        ? (this.transportsMap.get(sessionId) as StreamableHTTPServerTransport)
        : undefined;

      if (!transport) {
        logger.error(`Server: No transport found for MCP DELETE session: ${sessionId}`);
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_SESSION_ID });
        return;
      }

      try {
        await transport.handleRequest(request.raw, reply.raw);
        // Assume transport.handleRequest will send response or transport.onclose will cleanup
        if (!reply.sent) {
          reply.code(HTTP_STATUS.NO_CONTENT).send();
        }
      } catch (error: any) {
        logger.error(`Server: Error in MCP DELETE - ${error.message}`);
        if (!reply.sent) {
          reply
            .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.MCP_SESSION_DELETION_ERROR });
        }
      }
    });

    logger.debug('Server: All routes set up successfully');
  }

  public async start(port = NATIVE_SERVER_PORT, nativeHost: NativeMessagingHost): Promise<void> {
    logger.info(`Server: Starting server on port ${port}`);

    if (!this.nativeHost) {
      this.nativeHost = nativeHost; // Ensure nativeHost is set
      logger.debug('Server: Native host set during start');
    } else if (this.nativeHost !== nativeHost) {
      this.nativeHost = nativeHost; // Update to the passed instance
      logger.debug('Server: Native host updated during start');
    }

    if (this.isRunning) {
      logger.warn('Server: Server is already running');
      return;
    }

    try {
      await this.fastify.listen({ port, host: SERVER_CONFIG.HOST });
      this.isRunning = true; // Update running status
      logger.info(`Server: Server started successfully on ${SERVER_CONFIG.HOST}:${port}`);
      // No need to return, Promise resolves void by default
    } catch (err: any) {
      this.isRunning = false; // Startup failed, reset status
      logger.error(`Server: Failed to start server - ${err.message}`);
      // Throw error instead of exiting directly, let caller (possibly NativeHost) handle
      throw err; // or return Promise.reject(err);
      // process.exit(1); // Not recommended to exit directly here
    }
  }

  public async stop(): Promise<void> {
    logger.info('Server: Stopping server');

    if (!this.isRunning) {
      logger.warn('Server: Server is not running');
      return;
    }
    // this.nativeHost = null; // Not recommended to nullify here, association relationship may still be needed
    try {
      await this.fastify.close();
      this.isRunning = false; // Update running status
      logger.info('Server: Server stopped successfully');
    } catch (err: any) {
      // Even if closing fails, mark as not running, but log the error
      this.isRunning = false;
      logger.error(`Server: Error stopping server - ${err.message}`);
      throw err; // Throw error
    }
  }

  public getInstance(): FastifyInstance {
    return this.fastify;
  }
}

const serverInstance = new Server();
export default serverInstance;
