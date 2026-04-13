/**
 * Comprehensive RBAC Test Suite
 * Run with: npm test
 */

const assert = require('assert');
const { 
  hasPermission, 
  getMembership, 
  assignRoomOwner,
  checkSocketPermission,
  requirePermission,
  requireMinRole,
  PERMISSIONS,
  ROLE_HIERARCHY
} = require('../middleware/rbac');
const RoomMember = require('../models/RoomMember');
const Room = require('../models/Room');

// Mock data
const TEST_ROOM_ID = 'test-room-123';
const TEST_USER_ID = '507f1f77bcf86cd799439011'; // Valid ObjectId format
const TEST_USERNAME = 'testuser';

// Test helper to clean up
async function cleanup() {
  await RoomMember.deleteMany({ roomId: TEST_ROOM_ID });
  await Room.deleteMany({ roomId: TEST_ROOM_ID });
}

// Test 1: Permission checks
console.log('Test 1: Permission checks...');
assert.strictEqual(hasPermission('owner', 'EDIT_FILES'), true, 'Owner should edit');
assert.strictEqual(hasPermission('admin', 'EDIT_FILES'), true, 'Admin should edit');
assert.strictEqual(hasPermission('editor', 'EDIT_FILES'), true, 'Editor should edit');
assert.strictEqual(hasPermission('viewer', 'EDIT_FILES'), false, 'Viewer should not edit');
assert.strictEqual(hasPermission('viewer', 'VIEW_ROOM'), true, 'Viewer should view');
console.log('✓ Permission checks passed');

// Test 2: Role hierarchy
console.log('Test 2: Role hierarchy...');
assert.strictEqual(ROLE_HIERARCHY.owner, 4, 'Owner is level 4');
assert.strictEqual(ROLE_HIERARCHY.viewer, 1, 'Viewer is level 1');
console.log('✓ Role hierarchy passed');

// Test 3: Invalid ObjectId handling
console.log('Test 3: Invalid ObjectId handling...');
async function testInvalidUserId() {
  const result = await getMembership(TEST_ROOM_ID, 'invalid-id', TEST_USERNAME);
  assert.strictEqual(result, null, 'Should return null for invalid userId');
  console.log('✓ Invalid ObjectId handling passed');
}

// Test 4: Membership creation
console.log('Test 4: Membership creation...');
async function testMembershipCreation() {
  await cleanup();
  
  // Create room first
  const room = new Room({ roomId: TEST_ROOM_ID, name: 'Test Room' });
  await room.save();
  
  // Get membership (should create viewer)
  const member = await getMembership(TEST_ROOM_ID, TEST_USER_ID, TEST_USERNAME);
  assert.strictEqual(member.role, 'viewer', 'New member should be viewer');
  assert.strictEqual(member.username, TEST_USERNAME, 'Username should match');
  
  // Second call should return same member
  const member2 = await getMembership(TEST_ROOM_ID, TEST_USER_ID, TEST_USERNAME);
  assert.strictEqual(member2._id.toString(), member._id.toString(), 'Should return same member');
  
  console.log('✓ Membership creation passed');
}

// Test 5: Owner assignment
console.log('Test 5: Owner assignment...');
async function testOwnerAssignment() {
  await cleanup();
  
  // Create room
  const room = new Room({ roomId: TEST_ROOM_ID, name: 'Test Room' });
  await room.save();
  
  // Assign owner
  const owner = await assignRoomOwner(TEST_ROOM_ID, TEST_USER_ID, TEST_USERNAME);
  assert.strictEqual(owner.role, 'owner', 'Should be owner');
  
  // Second assignment should fail
  try {
    await assignRoomOwner(TEST_ROOM_ID, TEST_USER_ID, TEST_USERNAME);
    assert.fail('Should throw error for duplicate owner');
  } catch (err) {
    assert.ok(err.message.includes('already has an owner'), 'Should error on duplicate owner');
  }
  
  console.log('✓ Owner assignment passed');
}

// Test 6: Socket permission check
console.log('Test 6: Socket permission check...');
async function testSocketPermission() {
  await cleanup();
  
  // Create room and owner
  const room = new Room({ roomId: TEST_ROOM_ID, name: 'Test Room' });
  await room.save();
  await assignRoomOwner(TEST_ROOM_ID, TEST_USER_ID, TEST_USERNAME);
  
  // Mock socket
  const mockSocket = {
    userId: TEST_USER_ID,
    username: TEST_USERNAME
  };
  
  const perm = await checkSocketPermission(mockSocket, TEST_ROOM_ID, 'EDIT_FILES');
  assert.strictEqual(perm.allowed, true, 'Owner should have edit permission');
  assert.strictEqual(perm.role, 'owner', 'Should return owner role');
  
  console.log('✓ Socket permission check passed');
}

// Run all tests
async function runTests() {
  console.log('\n=== RBAC Test Suite ===\n');
  
  try {
    await testInvalidUserId();
    await testMembershipCreation();
    await testOwnerAssignment();
    await testSocketPermission();
    
    console.log('\n✅ All tests passed!\n');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Only run if called directly
if (require.main === module) {
  runTests();
}

module.exports = { runTests };
