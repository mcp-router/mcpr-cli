/**
 * Displays help information for the mcpr CLI
 */
export function executeHelp(): void {
  console.log(`
MCP Router CLI (mcpr) - Command-line tool for Model Context Protocol Router

Usage:
  mcpr [command] [options]

Commands:
  connect     Connect to an existing MCP HTTP Server running in the Electron application
    Options:
      --host <hostname>  Specify the host (default: localhost)
      --port <port>      Specify the port (default: 3030)
  
  version     Display the current version of mcpr
  help        Display this help information

Examples:
  mcpr connect                       Connect to the local MCP HTTP Server
  mcpr connect --port 8080           Connect to the local MCP HTTP Server on port 8080
  mcpr connect --host api.example.com --port 3030  Connect to a remote MCP HTTP Server
  mcpr version                       Show version information
  mcpr help                          Display this help information
  `);
}
