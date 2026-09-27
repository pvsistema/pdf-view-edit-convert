import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { purgeOcrCache } from '@/lib/purgeOcrCache'

// Убираем словари распознавания, оставшиеся от прошлых версий программы
purgeOcrCache();

createRoot(document.getElementById("root")!).render(<App />);