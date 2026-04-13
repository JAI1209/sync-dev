#!/usr/bin/env node
/**
 * Quick Verification Script
 * Run: node verify.js
 * 
 * This checks the codebase for common issues
 */

const fs = require('fs');
const path = require('path');

const CHECKS = {
  server: [
    { file: 'Server/server.js', check: /bulk-import.*async/, desc: 'bulk-import handler exists' },
    { file: 'Server/server.js', check: /io\.to.*emit.*bulk-imported/, desc: 'bulk-imported broadcast uses io.to' },
    { file: 'Server/server.js', check: /folders:\s*\{\}/, desc: 'folders initialized in makeDefaultRoom' },
    { file: 'Server/middleware/rbac.js', check: /mongoose\.Types\.ObjectId/, desc: 'ObjectId conversion for MongoDB' },
    { file: 'Server/server.js', check: /socket\.userId\s*=.*decoded\.user/, desc: 'socket.userId set in auth' },
  ],
  client: [
    { file: 'Client/src/pages/Editor.jsx', check: /readOnly.*userRole.*===.*"viewer"/, desc: 'Monaco readOnly for viewers' },
    { file: 'Client/src/pages/Editor.jsx', check: /socket\.on\("bulk-imported"/, desc: 'bulk-imported handler exists' },
    { file: 'Client/src/pages/Editor.jsx', check: /userRole === "viewer" \? "⬆ View Only"/, desc: 'Upload shows View Only for viewers' },
    { file: 'Client/src/pages/Editor.jsx', check: /socket\.on\("role-changed"/, desc: 'role-changed socket handler' },
  ]
};

function checkFile(filePath, pattern, desc) {
  const fullPath = path.join(__dirname, filePath);
  
  if (!fs.existsSync(fullPath)) {
    return { status: 'missing', desc, file: filePath };
  }
  
  const content = fs.readFileSync(fullPath, 'utf-8');
  const found = pattern.test(content);
  
  return {
    status: found ? 'pass' : 'fail',
    desc,
    file: filePath
  };
}

console.log('\n=== SyncDev Verification ===\n');

let passed = 0;
let failed = 0;
let missing = 0;

for (const [section, checks] of Object.entries(CHECKS)) {
  console.log(`${section.toUpperCase()}:`);
  
  for (const { file, check, desc } of checks) {
    const result = checkFile(file, check, desc);
    
    if (result.status === 'pass') {
      console.log(`  ✅ ${desc}`);
      passed++;
    } else if (result.status === 'fail') {
      console.log(`  ❌ ${desc} - NOT FOUND`);
      failed++;
    } else {
      console.log(`  ⚠️  ${desc} - FILE MISSING`);
      missing++;
    }
  }
  
  console.log('');
}

console.log('='.repeat(40));
console.log(`Results: ${passed} passed, ${failed} failed, ${missing} missing`);

if (failed > 0) {
  console.log('\n❌ Verification FAILED - some features may not work');
  process.exit(1);
} else if (missing > 0) {
  console.log('\n⚠️  Some files missing but critical features present');
  process.exit(0);
} else {
  console.log('\n✅ All verifications passed!');
  process.exit(0);
}
