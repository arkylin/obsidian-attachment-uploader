// Polyfills for Node.js modules in browser environment

// Create fallback Buffer implementation
function createFallbackBuffer() {
    return {
        from: function(data) {
            if (data instanceof ArrayBuffer) {
                return new Uint8Array(data);
            }
            if (typeof data === 'string') {
                // Simple string to bytes conversion
                const bytes = new Uint8Array(data.length);
                for (let i = 0; i < data.length; i++) {
                    bytes[i] = data.charCodeAt(i) & 0xFF;
                }
                return bytes;
            }
            return new Uint8Array(data);
        },
        isBuffer: function(obj) {
            return obj instanceof Uint8Array;
        }
    };
}

// Try to import Buffer, fallback if it fails
let BufferImpl;
let processImpl;

try {
    const bufferModule = require('buffer');
    if (bufferModule && bufferModule.Buffer && typeof bufferModule.Buffer.from === 'function') {
        BufferImpl = bufferModule.Buffer;
    } else {
        BufferImpl = createFallbackBuffer();
    }
} catch (e) {
    BufferImpl = createFallbackBuffer();
}

try {
    const process = require('process');
    processImpl = process;
} catch (e) {
    console.warn('Process import failed on mobile, using fallback:', e.message);
    processImpl = { env: {} };
}

// Make Buffer and process available globally
globalThis.Buffer = BufferImpl;
globalThis.process = processImpl;

// Ensure process.Buffer is available for mobile compatibility
if (globalThis.process && !globalThis.process.Buffer) {
    globalThis.process.Buffer = globalThis.Buffer;
}

// Additional polyfills
globalThis.global = globalThis;