import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { DocSource } from '@/context/DocContext';

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
};

const TabsCtx = createContext<Ctx | null>(null);

let tabSeq = 0;

const titleOf = (source: File | DocSource) =>
  source instanceof File ? source.name : source.name || 'Документ';

export const TabsProvider = ({ children }: { children: React.ReactNode }) => {
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const tabsRef = useRef<TabItem[]>([]);
  tabsRef.current = tabs;

  // Каждый документ открывается своей вкладкой: прежний остаётся на месте
  const openTab = useCallback((source: File | DocSource) => {
    const id = `t${++tabSeq}`;
    setTabs((list) => [...list, { id, title: titleOf(source), source }]);
    setActiveId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
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

  const selectTab = useCallback((id: string) => setActiveId(id), []);

  const renameTab = useCallback((id: string, title: string) => {
    setTabs((list) => list.map((t) => (t.id === id ? { ...t, title } : t)));
  }, []);

  const activeTitle = tabs.find((t) => t.id === activeId)?.title || '';

  const value = useMemo(
    () => ({ tabs, activeId, openTab, closeTab, selectTab, renameTab, activeTitle }),
    [tabs, activeId, openTab, closeTab, selectTab, renameTab, activeTitle],
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