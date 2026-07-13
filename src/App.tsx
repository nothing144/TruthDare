import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Home from './features/room/Home';
import RoomManager from './features/room/RoomManager';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-[var(--color-background)] text-gray-100 font-sans selection:bg-[var(--color-primary)] selection:text-white">
        <Toaster 
          position="top-center"
          toastOptions={{
            style: {
              background: '#1a1a2e',
              color: '#fff',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            },
            success: {
              iconTheme: {
                primary: '#10b981',
                secondary: '#fff',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
              },
            },
          }}
        />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomCode" element={<RoomManager />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
