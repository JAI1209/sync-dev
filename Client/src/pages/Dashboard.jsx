export default function Dashboard({ onLogout }) {
  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', borderBottom: '1px solid #2a2e3d', paddingBottom: '1rem' }}>
        <h2 style={{ color: '#4f8ef7', fontFamily: 'monospace' }}>SyncDev</h2>
        <button style={{ width: 'auto', padding: '8px 16px' }} onClick={onLogout}>
          Logout
        </button>
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Welcome back</h3>
        <p style={{ color: '#6b7094', marginBottom: '2rem', fontSize: '13px' }}>
          Create a room or join an existing one
        </p>

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button style={{ background: '#4f8ef7' }}>
            Create Room
          </button>
          <button style={{ background: 'transparent', border: '1px solid #2a2e3d', color: '#e8eaf0' }}>
            Join Room
          </button>
        </div>
      </div>
    </div>
  )
}

