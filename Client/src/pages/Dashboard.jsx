import { useState } from 'react';
import { useNavigate } from 'react-router-dom';



export default function Dashboard({ onLogout ,username }) {
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const createRoom = () =>{
    const id =Math.random().toString(36).substring(2, 8);
    navigate(`/editor/${id}`);
  }

  const joinRoom = () => {
    if(!roomId.trim()){
      setError('Enter a room code');
      return;
    }
    navigate(`/editor/${roomId.trim()}`);
  };

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', borderBottom: '1px solid #2a2e3d', paddingBottom: '1rem' }}>
        <h2 style={{ color: '#4f8ef7', fontFamily: 'monospace' }}>SyncDev</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ color: '#6b7094', fontSize: '13px', fontFamily: 'monospace' }}>{username}</span>
          <button style={{ width: 'auto', padding: '8px 16px' }} onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div style={{ maxWidth: '480px', margin: '4rem auto', textAlign: 'center' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Welcome, {username}</h3>
        <p style={{ color: '#6b7094', fontSize: '13px', marginBottom: '2rem' }}>
          Create a new room or join an existing one
        </p>

        <button onClick={createRoom} style={{ marginBottom: '1rem' }}>
          + Create Room
        </button>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input
            placeholder="Enter room code"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          <button onClick={joinRoom} style={{ width: 'auto', padding: '8px 20px', background: 'transparent', border: '1px solid #2a2e3d' }}>
            Join
          </button>
        </div>

        {error && <p className="error" style={{ marginTop: '0.5rem' }}>{error}</p>}
      </div>
    </div>
  )
}

