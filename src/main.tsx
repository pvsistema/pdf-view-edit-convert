import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { purgeOcrCache } from '@/lib/purgeOcrCache'
import { watchPageErrors } from '@/lib/desktop'

// Убираем словари распознавания, оставшиеся от прошлых версий программы
purgeOcrCache();

// Сбои интерфейса — в журнал программы
watchPageErrors();

createRoot(document.getElementById("root")!).render(<App />);