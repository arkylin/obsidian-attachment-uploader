// Polyfills for Node.js modules in browser environment
import { Buffer } from 'buffer';
import process from 'process';

// Make Buffer and process available globally
globalThis.Buffer = Buffer;
globalThis.process = process;

// Additional polyfills
globalThis.global = globalThis;