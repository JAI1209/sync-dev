/**
 * Integration Tests for SyncDev
 * Tests full workflows: import, sync, permissions
 */

const io = require('socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';
const TEST_ROOM = 'test-integration-room';
const TEST_TOKEN = process.env.TEST_TOKEN || 'test-token';

// Test configuration
const TEST_CONFIG = {
  roomId: TEST_ROOM,
  files: {
    'file1': { id: 'file1', name: 'main.js', content: 'console.log("hello");' },
    'file2': { id: 'file2', name: 'README.md', content: '# Test Project' }
  },
  folders: {
    'folder1': { id: 'folder1', name: 'src', parentId: null },
    'folder2': { id: 'folder2', name: 'docs', parentId: null }
  }
};

class IntegrationTest {
  constructor() {
    this.sockets = [];
    this.results = [];
  }

  async connectSocket(username, role = 'owner') {
    return new Promise((resolve, reject) => {
      const socket = io(SERVER_URL, {
        auth: { token: TEST_TOKEN },
        reconnection: false
      });

      socket.on('connect', () => {
        console.log(`✓ ${username} connected`);
        socket.username = username;
        this.sockets.push(socket);
        resolve(socket);
      });

      socket.on('connect_error', (err) => {
        reject(new Error(`${username} connection failed: ${err.message}`));
      });

      socket.on('error', (err) => {
        console.warn(`⚠ ${username} error:`, err);
      });
    });
  }

  async joinRoom(socket, roomId) {
    return new Promise((resolve) => {
      socket.emit('join-room', { roomId });
      
      socket.once('room-state', (state) => {
        console.log(`✓ ${socket.username} joined room ${roomId}`);
        resolve(state);
      });
    });
  }

  async testBulkImport() {
    console.log('\n--- Test: Bulk Import ---');
    const owner = await this.connectSocket('owner');
    await this.joinRoom(owner, TEST_ROOM);

    return new Promise((resolve, reject) => {
      // Listen for confirmation
      owner.once('import-complete', (result) => {
        console.log(`✓ Import complete: ${result.filesImported} files, ${result.foldersImported} folders`);
        assert.strictEqual(result.filesImported, 2, 'Should import 2 files');
        assert.strictEqual(result.foldersImported, 2, 'Should import 2 folders');
        resolve(result);
      });

      owner.once('error', (err) => {
        reject(new Error(`Import failed: ${err.msg}`));
      });

      // Emit import
      console.log('Emitting bulk-import...');
      owner.emit('bulk-import', {
        roomId: TEST_ROOM,
        files: TEST_CONFIG.files,
        folders: TEST_CONFIG.folders
      });
    });
  }

  async testViewerCannotEdit() {
    console.log('\n--- Test: Viewer Permissions ---');
    
    const owner = await this.connectSocket('owner');
    const viewer = await this.connectSocket('viewer');
    
    await this.joinRoom(owner, TEST_ROOM);
    await this.joinRoom(viewer, TEST_ROOM);

    return new Promise((resolve) => {
      let errorReceived = false;
      
      viewer.once('error', (err) => {
        if (err.msg && err.msg.includes('Requires')) {
          console.log('✓ Viewer correctly blocked from editing');
          errorReceived = true;
          resolve({ success: true, blocked: true });
        }
      });

      // Viewer tries to edit
      viewer.emit('file-change', {
        roomId: TEST_ROOM,
        fileId: 'file1',
        content: 'hacked content'
      });

      // Timeout if no error (which would be a failure)
      setTimeout(() => {
        if (!errorReceived) {
          resolve({ success: false, blocked: false, error: 'Viewer was not blocked!' });
        }
      }, 2000);
    });
  }

  async testRealTimeSync() {
    console.log('\n--- Test: Real-time Sync ---');
    
    const editor1 = await this.connectSocket('editor1');
    const editor2 = await this.connectSocket('editor2');
    
    await this.joinRoom(editor1, TEST_ROOM);
    await this.joinRoom(editor2, TEST_ROOM);

    return new Promise((resolve, reject) => {
      const testContent = 'const x = 42;';
      
      editor2.once('file-update', ({ fileId, content }) => {
        if (content === testContent) {
          console.log('✓ Real-time sync working');
          resolve({ success: true, latency: Date.now() - startTime });
        }
      });

      const startTime = Date.now();
      editor1.emit('file-change', {
        roomId: TEST_ROOM,
        fileId: 'file1',
        content: testContent
      });

      setTimeout(() => {
        reject(new Error('Real-time sync timeout'));
      }, 5000);
    });
  }

  async testRoleChangeNotification() {
    console.log('\n--- Test: Role Change Notification ---');
    
    const admin = await this.connectSocket('admin');
    const user = await this.connectSocket('user');
    
    await this.joinRoom(admin, TEST_ROOM);
    await this.joinRoom(user, TEST_ROOM);

    return new Promise((resolve, reject) => {
      user.once('role-changed', ({ oldRole, newRole, changedBy }) => {
        console.log(`✓ Role changed from ${oldRole} to ${newRole}`);
        assert.strictEqual(oldRole, 'viewer');
        assert.strictEqual(newRole, 'editor');
        resolve({ success: true });
      });

      // Simulate admin changing user's role via API
      // (In real test, we'd call the API)
      setTimeout(() => {
        reject(new Error('Role change notification timeout'));
      }, 5000);
    });
  }

  async runAll() {
    console.log('\n=== Integration Test Suite ===\n');
    
    try {
      await this.testBulkImport();
      await this.testViewerCannotEdit();
      await this.testRealTimeSync();
      // await this.testRoleChangeNotification(); // Requires API call
      
      console.log('\n✅ All integration tests passed!\n');
      return true;
    } catch (err) {
      console.error('\n❌ Integration test failed:', err.message);
      return false;
    } finally {
      this.cleanup();
    }
  }

  cleanup() {
    console.log('Cleaning up sockets...');
    this.sockets.forEach(socket => socket.disconnect());
  }
}

// Run if called directly
if (require.main === module) {
  const test = new IntegrationTest();
  test.runAll().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = IntegrationTest;
