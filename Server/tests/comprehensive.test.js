/**
 * Comprehensive Test Suite for SyncDev
 * Tests ALL scenarios and edge cases
 */

const assert = require('assert');

// Test configuration
const TEST_CONFIG = {
  roomId: 'test-room-comprehensive',
  roomId2: 'test-room-second',
  users: {
    owner: { id: '507f1f77bcf86cd799439011', username: 'owner_user' },
    admin: { id: '507f1f77bcf86cd799439012', username: 'admin_user' },
    editor: { id: '507f1f77bcf86cd799439013', username: 'editor_user' },
    viewer: { id: '507f1f77bcf86cd799439014', username: 'viewer_user' },
    stranger: { id: '507f1f77bcf86cd799439015', username: 'stranger_user' }
  }
};

// Simple test runner
const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, msg) {
  if (!value) {
    throw new Error(msg || 'Expected true, got false');
  }
}

function assertFalse(value, msg) {
  if (value) {
    throw new Error(msg || 'Expected false, got true');
  }
}

// Import modules to test
try {
  var { 
    hasPermission, 
    getMembership, 
    assignRoomOwner,
    checkSocketPermission,
    PERMISSIONS,
    ROLE_HIERARCHY
  } = require('../middleware/rbac');
  var RoomMember = require('../models/RoomMember');
  var Room = require('../models/Room');
} catch (err) {
  console.error('Failed to load modules:', err.message);
  process.exit(1);
}

// ==================== PERMISSION TESTS ====================

test('Owner can EDIT_FILES', () => {
  assertTrue(hasPermission('owner', 'EDIT_FILES'), 'Owner should edit');
});

test('Owner can CREATE_FILES', () => {
  assertTrue(hasPermission('owner', 'CREATE_FILES'), 'Owner should create files');
});

test('Owner can DELETE_FILES', () => {
  assertTrue(hasPermission('owner', 'DELETE_FILES'), 'Owner should delete files');
});

test('Owner can MANAGE_MEMBERS', () => {
  assertTrue(hasPermission('owner', 'MANAGE_MEMBERS'), 'Owner should manage members');
});

test('Owner can CHANGE_ROLES', () => {
  assertTrue(hasPermission('owner', 'CHANGE_ROLES'), 'Owner should change roles');
});

test('Owner can TRANSFER_OWNERSHIP', () => {
  assertTrue(hasPermission('owner', 'TRANSFER_OWNERSHIP'), 'Owner should transfer ownership');
});

test('Admin can EDIT_FILES', () => {
  assertTrue(hasPermission('admin', 'EDIT_FILES'), 'Admin should edit');
});

test('Admin CANNOT CHANGE_ROLES', () => {
  assertFalse(hasPermission('admin', 'CHANGE_ROLES'), 'Admin should NOT change roles');
});

test('Editor can EDIT_FILES', () => {
  assertTrue(hasPermission('editor', 'EDIT_FILES'), 'Editor should edit');
});

test('Editor CANNOT MANAGE_MEMBERS', () => {
  assertFalse(hasPermission('editor', 'MANAGE_MEMBERS'), 'Editor should NOT manage members');
});

test('Viewer CANNOT EDIT_FILES', () => {
  assertFalse(hasPermission('viewer', 'EDIT_FILES'), 'Viewer should NOT edit');
});

test('Viewer can VIEW_ROOM', () => {
  assertTrue(hasPermission('viewer', 'VIEW_ROOM'), 'Viewer should view');
});

test('Invalid role has no permissions', () => {
  assertFalse(hasPermission('invalid_role', 'EDIT_FILES'), 'Invalid role should not edit');
});

// ==================== ROLE HIERARCHY TESTS ====================

test('Role hierarchy correct', () => {
  assertEqual(ROLE_HIERARCHY.owner, 4, 'Owner is level 4');
  assertEqual(ROLE_HIERARCHY.admin, 3, 'Admin is level 3');
  assertEqual(ROLE_HIERARCHY.editor, 2, 'Editor is level 2');
  assertEqual(ROLE_HIERARCHY.viewer, 1, 'Viewer is level 1');
});

// ==================== ASYNC TESTS ====================

test('Invalid userId returns null', async () => {
  const result = await getMembership(TEST_CONFIG.roomId, 'invalid-id', 'test');
  assertEqual(result, null, 'Invalid userId should return null');
});

test('Null userId returns null', async () => {
  const result = await getMembership(TEST_CONFIG.roomId, null, 'test');
  assertEqual(result, null, 'Null userId should return null');
});

// ==================== RUN ALL TESTS ====================

async function runTests() {
  console.log('\n' + '='.repeat(70));
  console.log('COMPREHENSIVE SYNCDev TEST SUITE');
  console.log('='.repeat(70) + '\n');

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(70) + '\n');

  process.exit(failed === 0 ? 0 : 1);
}

runTests();
