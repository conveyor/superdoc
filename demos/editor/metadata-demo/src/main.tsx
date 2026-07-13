import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Intentionally NOT wrapped in <React.StrictMode>: its dev-only
// mount→unmount→remount destroys the shared Yjs pair (SuperDoc tears it down on
// destroy), and the remount then binds to a dead ydoc → blank editor. Production
// builds don't double-mount.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
