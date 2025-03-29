#!/usr/bin/env node
import { executeConnect } from './commands/connect.js';
import { executeHelp } from './commands/help.js';
import { executeVersion } from './commands/version.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';

const VERSION = "0.0.1"

// Parse command-line arguments
const args = process.argv.slice(2);
const command = args[0] || 'help';
const commandArgs = args.slice(1); // Get arguments after the command

// Execute the appropriate command based on the input
async function main() {
  try {
    switch (command) {
      case 'connect':
        await executeConnect(commandArgs);
        break;
      case 'version':
        executeVersion(VERSION);
        break;
      case 'help':
      default:
        executeHelp();
        break;
    }
  } catch (error) {
    console.error('Error executing command:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
