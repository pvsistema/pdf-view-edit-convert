import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { DocProvider, useDoc, type DocSource } from '@/context/DocContext';
import PagesPanel from '@/components/app/PagesPanel';
import Viewer, { type Tool } from '@/components/app/Viewer';
import ToolsPanel from '@/components/app/ToolsPanel';
import AppBar from '@/components/app/AppBar';
import { useTabs, ActiveTabProvider } from '@/context/TabsContext';
import { registerTab } from '@/lib/pageSwap';

type Props = { source: File | DocSource; tabId: string; activeTab: boolean };

// Рабочая область одной вкладки: документ открывается один раз
// и остаётся готовым, пока вкладку не закроют
const Inner = ({ source, tabId }: Omit<Props, 'activeTab'>) => {
  const { pages, name, open, loading, insertPage, remove } = useDoc();
  const [tool, setTool] = useState<Tool>('hand');
  const [panel, setPanel] = useState<'pages' | 'tools' | null>(null);
  const tabsApi = useTabs();
  const rename = tabsApi?.renameTab;

  // Свежий список страниц нужен обменнику в момент переноса
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  useEffect(() => {
    void open(source);
  }, [source, open]);

  // Имя документа показываем на вкладке
  useEffect(() => {
    if (name && rename) rename(tabId, name);
  }, [name, rename, tabId]);

  // Сообщаем о себе обменнику: так соседние вкладки смогут
  // передать сюда страницу перетаскиванием мышью
  useEffect(
    () =>
      registerTab(tabId, {
        accept: (cargo, at) =>
          insertPage(cargo.page, cargo.file, at, `перенос страницы из «${cargo.label}»`),
        drop: (uid) => remove(uid),
        count: () => pagesRef.current.length,
      }),
    [tabId, insertPage, remove],
  );

  if (!pages.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <AppBar />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Icon
              name={loading ? 'LoaderCircle' : 'FileText'}
              size={28}
              className={loading ? 'animate-spin text-primary' : 'text-muted-foreground'}
            />
            <span className="text-[0.88rem] text-muted-foreground">
              {loading ? 'Открываю документ' : 'Документ не открылся'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppBar />
      <div className="relative flex min-h-0 flex-1">
        <div className="hidden lg:flex">
          <PagesPanel />
        </div>

        <Viewer tool={tool} setTool={setTool} />

        <div className="hidden xl:flex">
          <ToolsPanel />
        </div>

        {panel && (
          <div className="absolute inset-0 z-40 flex xl:hidden">
            <button
              className="flex-1 bg-foreground/40"
              onClick={() => setPanel(null)}
              aria-label="Закрыть панель"
            />
            <div className="animate-fade-in h-full bg-card shadow-2xl">
              {panel === 'pages' ? <PagesPanel /> : <ToolsPanel />}
            </div>
          </div>
        )}

        <div className="absolute bottom-4 right-4 z-30 flex gap-2 xl:hidden">
          <button
            onClick={() => setPanel(panel === 'pages' ? null : 'pages')}
            className="flex h-12 w-12 items-center justify-center border border-foreground bg-background lg:hidden"
            title="Страницы"
          >
            <Icon name="Files" size={20} />
          </button>
          <button
            onClick={() => setPanel(panel === 'tools' ? null : 'tools')}
            className="flex h-12 w-12 items-center justify-center bg-primary text-primary-foreground"
            title="Инструменты"
          >
            <Icon name="Wrench" size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

const DocWorkspace = ({ source, tabId, activeTab }: Props) => (
  <ActiveTabProvider value={activeTab}>
    <DocProvider>
      <Inner source={source} tabId={tabId} />
    </DocProvider>
  </ActiveTabProvider>
);

export default DocWorkspace;
