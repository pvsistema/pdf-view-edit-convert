import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { DocSource } from '@/context/DocContext';
import { addRecent } from '@/lib/recent';
import { isDesktop, reportUnsaved } from '@/lib/desktop';

export type TabItem = {
  id: string;
  title: string;
  // Документ, который вкладка откроет при первом показе
  source: File | DocSource;
};

type Ctx = {
  tabs: TabItem[];
  activeId: string;
  openTab: (source: File | DocSource) => void;
  closeTab: (id: string) => void;
  selectTab: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  activeTitle: string;
  // Вкладка сообщает, есть ли в ней правки, которых нет в файле
  setTabDirty: (id: string, dirty: boolean) => void;
  // Названия документов с несохранёнными правками
  unsavedTitles: string[];
  // Есть ли несохранённая работа в этой вкладке
  isTabDirty: (id: string) => boolean;
};

const TabsCtx = createContext<Ctx | null>(null);

let tabSeq = 0;

const titleOf = (source: File | DocSource) =>
  source instanceof File ? source.name : source.name || 'Документ';

export const TabsProvider = ({ children }: { children: React.ReactNode }) => {
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeId, setActiveId] = useState('');
  // Какие вкладки держат несохранённую работу
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  const tabsRef = useRef<TabItem[]>([]);
  tabsRef.current = tabs;

  // Каждый документ открывается своей вкладкой: прежний остаётся на месте
  const openTab = useCallback((source: File | DocSource) => {
    const id = `t${++tabSeq}`;
    setTabs((list) => [...list, { id, title: titleOf(source), source }]);
    setActiveId(id);

    // Запоминаем документ для списка последних на стартовом окне
    addRecent(
      source instanceof File
        ? { name: source.name, size: source.size }
        : { name: source.name, size: source.size ?? 0, url: source.url },
    );
  }, []);

  const closeTab = useCallback((id: string) => {
    setDirtyIds((list) => list.filter((x) => x !== id));
    setTabs((list) => {
      const at = list.findIndex((t) => t.id === id);
      if (at < 0) return list;
      const next = list.filter((t) => t.id !== id);

      // После закрытия переходим на соседнюю вкладку
      setActiveId((cur) => {
        if (cur !== id) return cur;
        if (!next.length) return '';
        return next[Math.min(at, next.length - 1)].id;
      });
      return next;
    });
  }, []);

  const setTabDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((list) => {
      const has = list.includes(id);
      if (dirty === has) return list;
      return dirty ? [...list, id] : list.filter((x) => x !== id);
    });
  }, []);

  const dirtyRef = useRef<string[]>([]);
  dirtyRef.current = dirtyIds;
  const isTabDirty = useCallback((id: string) => dirtyRef.current.includes(id), []);

  const selectTab = useCallback((id: string) => setActiveId(id), []);

  const renameTab = useCallback((id: string, title: string) => {
    setTabs((list) => list.map((t) => (t.id === id ? { ...t, title } : t)));
  }, []);

  const activeTitle = tabs.find((t) => t.id === activeId)?.title || '';

  // Закрытая вкладка больше ничего не держит
  const unsavedTitles = useMemo(
    () => tabs.filter((t) => dirtyIds.includes(t.id)).map((t) => t.title),
    [tabs, dirtyIds],
  );

  // Программа должна знать о несохранённом заранее: спросить в момент
  // закрытия окна она уже не успеет
  useEffect(() => {
    if (!isDesktop()) return;
    reportUnsaved(unsavedTitles.length > 0, unsavedTitles.join('\r\n'));
  }, [unsavedTitles]);

  // В браузере о потере работы предупреждает он сам: своё окно показать
  // на закрытии вкладки уже нельзя
  useEffect(() => {
    if (isDesktop() || !unsavedTitles.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsavedTitles]);

  const value = useMemo(
    () => ({
      tabs,
      activeId,
      openTab,
      closeTab,
      selectTab,
      renameTab,
      activeTitle,
      setTabDirty,
      unsavedTitles,
      isTabDirty,
    }),
    [
      tabs,
      activeId,
      openTab,
      closeTab,
      selectTab,
      renameTab,
      activeTitle,
      setTabDirty,
      unsavedTitles,
      isTabDirty,
    ],
  );

  return <TabsCtx.Provider value={value}>{children}</TabsCtx.Provider>;
};

// Вкладки доступны не везде: диалоги вне рабочего окна работают и без них
export const useTabs = () => useContext(TabsCtx);

// Признак «эта вкладка сейчас на экране». Скрытые вкладки остаются в памяти,
// но не должны отзываться на горячие клавиши
const ActiveCtx = createContext(true);

export const ActiveTabProvider = ActiveCtx.Provider;

export const useTabActive = () => useContext(ActiveCtx);