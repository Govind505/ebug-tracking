#!/usr/bin/env node

/**
 * eBug Tracking — Proto Code Generation
 * 
 * Generates TypeScript types from .proto definitions using @bufbuild.
 * Run: npm run proto:gen
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PROTO_DIR = path.join(ROOT, 'proto');
const OUT_DIR = path.join(ROOT, 'packages', 'core-proto', 'src', 'generated');

console.log('🔧 eBug Proto Code Generation');
console.log(`   Proto dir: ${PROTO_DIR}`);
console.log(`   Output:    ${OUT_DIR}`);

// Ensure output directory exists
if (!existsSync(OUT_DIR)) {
  mkdirSync(OUT_DIR, { recursive: true });
}

try {
  // Generate TypeScript from proto files using buf
  execSync(
    `npx buf generate --template buf.gen.yaml`,
    { cwd: PROTO_DIR, stdio: 'inherit' }
  );
  console.log('✅ Proto generation complete');
} catch (err) {
  console.warn('⚠️  buf not available — using manually maintained types in core-proto/src/index.ts');
  console.warn('   Install buf to enable auto-generation: npm i -D @bufbuild/buf');
  process.exit(0); // Non-fatal — we have manual types as fallback
}
