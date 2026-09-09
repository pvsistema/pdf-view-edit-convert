import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { onBookmarkRequest } from '@/lib/markBus';
import PagesPanel from '@/components/app/PagesPanel';
import BookmarksPanel from '@/components/app/BookmarksPanel';

type View = 'pages' | 'marks';

const VIEWS: { id: View; icon: string; title: string }[] = [
  { id: 'pages', icon: 'Files', title: 'Страницы' },
  { id: 'marks', icon: 'Bookmark', title: 'Закладки' },
];

// Левая часть окна: узкая полоска значков переключает вид,
// как в привычных программах для работы с документами
const SidePanel = () => {
  const [view, setView] = useState<View>('pages');

  // Ctrl+B ставит закладку, даже когда на экране миниатюры:
  // сначала показываем закладки, чтобы человек увидел результат
  useEffect(() => onBookmarkRequest(() => setView('marks')), []);

  return (
    <div className="flex h-full">
      <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-foreground py-2 text-background">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            title={v.title}
            className={`flex h-9 w-9 items-center justify-center transition-colors ${
              view === v.id ? 'bg-primary text-primary-foreground' : 'hover:bg-background/10'
            }`}
          >
            <Icon name={v.icon} size={17} />
          </button>
        ))}
      </div>

      {/* Оба вида остаются в памяти: скрытая панель закладок должна
          услышать Ctrl+B, даже когда на экране миниатюры */}
      <aside className="flex h-full w-[236px] shrink-0 flex-col border-r border-border bg-card">
        <div className={view === 'pages' ? 'flex h-full flex-col' : 'hidden'}>
          <PagesPanel />
        </div>
        <div className={view === 'marks' ? 'flex h-full flex-col' : 'hidden'}>
          <BookmarksPanel />
        </div>
      </aside>
    </div>
  );
};

export default SidePanel;