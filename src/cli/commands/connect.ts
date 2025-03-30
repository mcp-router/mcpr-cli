import fetch from 'node-fetch';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  InitializeRequestSchema,
  McpError,
  CallToolResult,
  GetPromptResult,
  ReadResourceResult
} from '@modelcontextprotocol/sdk/types.js';

const SERVER_NAME = 'MCP Router';
const VERSION = '0.0.2';

/**
 * Executes the connect command, connecting to an existing
 * MCP HTTP server running in the Electron application and exposing
 * its capabilities as an MCP server using stdio transport.
 */
export async function executeConnect(args: string[] = []): Promise<void> {
  
  // Parse arguments (if needed)
  const options = parseArgs(args);
  
  // Create and start the HTTP MCP Bridge Server
  const bridgeServer = new HttpMcpBridgeServer(options);
  await bridgeServer.start();
  
  // Keep the process running until interrupted
  process.on('SIGINT', async () => {
    await bridgeServer.stop();
    process.exit(0);
  });
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): {
  host: string;
  port: number;
  token: string | null;
} {
  // Default values
  const options: { host: string; port: number; token: string | null } = {
    host: 'localhost',
    port: 3282,
    token: null
  };
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--port' && i + 1 < args.length) {
      const port = parseInt(args[i + 1], 10);
      if (!isNaN(port)) {
        options.port = port;
        i++;
      }
    } else if (arg === '--host' && i + 1 < args.length) {
      options.host = args[i + 1];
      i++;
    } else if ((arg === '--token' || arg === '-t') && i + 1 < args.length) {
      options.token = args[i + 1];
      i++;
    }
  }
  
  return options;
}

/**
 * Interface definitions for HTTP responses
 */
interface ToolsResponse {
  tools: any[];
}

interface ResourcesResponse {
  resources: any[];
}

interface PromptsResponse {
  prompts: any[];
}

/**
 * HTTP-based MCP client for communicating with the MCP HTTP server
 */
class HttpMcpClient {
  private baseUrl: string;
  private clientName: string | null = null;
  private token: string | null = null;
  
  constructor(baseUrl: string, token: string | null = null) {
    this.baseUrl = baseUrl;
    this.token = token;
  }
  
  /**
   * Set client information
   * @param name Client name to include in requests
   */
  setClientInfo(name: string) {
    this.clientName = name;
  }
  
  /**
   * Get common headers for HTTP requests
   * @returns Headers object with content type and client info
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 
      'Content-Type': 'application/json' 
    };
    
    // Add client name to headers if available
    if (this.clientName) {
      headers['X-MCP-Client-Name'] = this.clientName;
    }
    
    // Add authorization token if available
    if (this.token) {
      headers['X-MCP-Token'] = this.token;
    }
    
    return headers;
  }
  
  /**
   * List all available tools from all servers
   */
  async listTools(): Promise<ToolsResponse> {
    const response = await fetch(`${this.baseUrl}/api/tools`, {
      headers: this.getHeaders()
    });
    if (!response.ok) {
      throw new Error(`Failed to list tools: ${response.statusText}`);
    }
    return response.json() as Promise<ToolsResponse>;
  }
  
  /**
   * Call a specific tool
   * @param name Tool name directly (no parsing)
   * @param args Arguments for the tool
   */
  async callTool(name: string, args: any = {}) {
    const response = await fetch(`${this.baseUrl}/api/tool-by-name/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(args)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to call tool ${name}: ${response.statusText}`);
    }
    
    return response.json();
  }
  
  /**
   * List all available resources from all servers
   */
  async listResources(): Promise<ResourcesResponse> {
    const response = await fetch(`${this.baseUrl}/api/resources`, {
      headers: this.getHeaders()
    });
    if (!response.ok) {
      throw new Error(`Failed to list resources: ${response.statusText}`);
    }
    return response.json() as Promise<ResourcesResponse>;
  }
  
  /**
   * Read a specific resource
   * @param uri Resource URI
   */
  async readResource(uri: string) {
    // Extract server name from resource URI (resource://serverName/path)
    const match = uri.match(/^resource:\/\/([^\/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid resource URI: ${uri}.`);
    }
    
    const [, serverName, path] = match;
    
    const response = await fetch(`${this.baseUrl}/api/resource?serverName=${encodeURIComponent(serverName)}&path=${encodeURIComponent(path)}`, {
      headers: this.getHeaders()
    });
    if (!response.ok) {
      throw new Error(`Failed to read resource ${uri}: ${response.statusText}`);
    }
    
    return response.json();
  }
  
  /**
   * List all available prompts from all servers
   */
  async listPrompts(): Promise<PromptsResponse> {
    const response = await fetch(`${this.baseUrl}/api/prompts`, {
      headers: this.getHeaders()
    });
    if (!response.ok) {
      throw new Error(`Failed to list prompts: ${response.statusText}`);
    }
    return response.json() as Promise<PromptsResponse>;
  }
  
  /**
   * Get a specific prompt
   * @param name Prompt name in format "serverName_promptName"
   * @param args Arguments for the prompt
   */
  async getPrompt(name: string, args: any = {}) {
    // Pass the full prompt name directly without splitting
    const response = await fetch(`${this.baseUrl}/api/prompt/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(args)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get prompt ${name}: ${response.statusText}`);
    }
    
    return response.json();
  }
}

/**
 * MCP Bridge Server that connects to an HTTP MCP server and
 * exposes its capabilities as an MCP server using stdio transport
 */
class HttpMcpBridgeServer {
  private server: Server;
  private client: HttpMcpClient;
  private baseUrl: string;
  private token: string | null;
  
  constructor(options: { host: string; port: number; token: string | null }) {
    this.baseUrl = `http://${options.host}:${options.port}`;
    this.token = options.token;
    this.client = new HttpMcpClient(this.baseUrl, this.token);
    
    // Initialize the MCP server
    this.server = new Server(
      {
        name: SERVER_NAME,
        version: VERSION
      },
      {
        capabilities: {
          resources: {},
          tools: {},
          prompts: {}
        },
      }
    );
    
    // Set up request handlers
    this.setupRequestHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Bridge Error]', error);
  }
  
  /**
   * Set up request handlers for the MCP server
   */
  private setupRequestHandlers(): void {

    // Initialize - Capture client info from the Initialize request
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      try {
        // Extract client name and set it in the HTTP client
        if (request.params.clientInfo && request.params.clientInfo.name) {
          const clientName = request.params.clientInfo.name;          
          this.client.setClientInfo(clientName);
        }
        return {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: {
            name: SERVER_NAME,
            version: VERSION
          }
        };
      } catch (error: any) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error during initialization: ${error.message}`
        );
      }
    });

    // List Tools
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      try {
        const response = await this.client.listTools();
        return { tools: response.tools || [] };
      } catch (error: any) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error listing tools: ${error.message}`
        );
      }
    });
    
    // Call Tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const result = await this.client.callTool(request.params.name, request.params.arguments || {});
        return result as CallToolResult;
      } catch (error: any) {
        throw new McpError(
            ErrorCode.InternalError,
            `Error calling tool ${request.params.name}: ${error.message}`
        );
      }
    });
    
    // List Resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        const response = await this.client.listResources();
        return { resources: response.resources || [] };
      } catch (error: any) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error listing resources: ${error.message}`
        );
      }
    });
    
    // List Resource Templates
    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      // HTTP server doesn't explicitly expose resource templates
      // Return empty list for now
      return { resourceTemplates: [] };
    });
    
    // Read Resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      try {
        const resource = await this.client.readResource(request.params.uri);
        return resource as ReadResourceResult;
      } catch (error: any) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error reading resource ${request.params.uri}: ${error.message}`
        );
      }
    });
    
    // List Prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      try {
        const response = await this.client.listPrompts();
        return { prompts: response.prompts || [] };
      } catch (error: any) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error listing prompts: ${error.message}`
        );
      }
    });
    
    // Get Prompt
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      try {
        const result = await this.client.getPrompt(request.params.name, request.params.args || {});
        return result as GetPromptResult;
      } catch (error: any) {
        throw new McpError(
            ErrorCode.InternalError,
            `Error getting prompt ${request.params.name}: ${error.message}`
        );
      }
    });
  }
  
  /**
   * Start the MCP server with stdio transport
   */
  async start(): Promise<void> {
    try {
      // First check if the HTTP server is running
      await this.testConnection();
      
      // Create and connect the stdio transport
      const transport = new StdioServerTransport();
      
      // Add error handling for stdin/stdout streams
      process.stdin.on('error', (err: Error) => {
        console.error('Stdin error:', err);
        process.exit(1);
      });
      
      process.stdout.on('error', (err: Error) => {
        console.error('Stdout error:', err);
        process.exit(1);
      });
      
      // StdioServerTransport doesn't support direct event handlers
      // We'll rely on the Server's error handler instead
      
      await this.server.connect(transport);
      
    } catch (error: any) {
      console.error('Failed to start MCP Bridge Server:', error.message);
      process.exit(1);
    }
  }
  
  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    try {
      await this.server.close();
    } catch (error) {
      console.error('Error stopping MCP Bridge Server:', error);
    }
  }

  /**
   * Test connection to the HTTP server
   */
  private async testConnection(): Promise<void> {
    try {
      // Check if the server is running with a timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      let response;
      try {
        const headers: Record<string, string> = {};
        if (this.token) {
          headers['X-MCP-Token'] = this.token;
        }
        
        response = await fetch(`${this.baseUrl}/api/test`, {
          signal: controller.signal,
          headers
        }).finally(() => clearTimeout(timeoutId));
      } catch (fetchError: any) {
        if (fetchError.code === 'ECONNREFUSED') {
          throw new Error(`Connection refused at ${this.baseUrl}. Make sure the Electron application is running and the HTTP server is enabled.`);
        } else if (fetchError.name === 'AbortError') {
          throw new Error(`Connection timed out after 5 seconds. The server at ${this.baseUrl} is not responding.`);
        } else {
          throw new Error(`Failed to connect to ${this.baseUrl}: ${fetchError.message}`);
        }
      }
      
      if (!response.ok) {
        const statusText = response.statusText ? ` (${response.statusText})` : '';
        throw new Error(`Server responded with status: ${response.status}${statusText}`);
      }
      
      // Define the expected response type and handle parsing errors
      interface ApiTestResponse {
        success: boolean;
        message: string;
        timestamp: string;
        aggregatorEnabled: boolean;
      }
      
      let data: ApiTestResponse;
      try {
        data = await response.json() as ApiTestResponse;
      } catch (err) {
        throw new Error(`Failed to parse server response as JSON. Server may not be fully initialized.`);
      }
    } catch (error: any) {
      console.error('Failed to connect to MCP HTTP Server:', error.message);
      console.error('Make sure the Electron application is running with the HTTP server enabled on port 3282');
      console.error('If the port is different, specify it with --port option');
      console.error('If authentication is required, provide an access token with --token option');
      throw error;
    }
  }
}

