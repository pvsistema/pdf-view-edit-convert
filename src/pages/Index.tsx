import { useEffect } from 'react';
import AppBar from '@/components/app/AppBar';
import Dropzone from '@/components/app/Dropzone';
import TabsBar from '@/components/app/TabsBar';
import DocWorkspace from '@/components/app/DocWorkspace';
import AppWindow from '@/components/app/AppWindow';
import { DocProvider } from '@/context/DocContext';
import { LicenseProvider } from '@/context/LicenseContext';
import { TabsProvider, useTabs } from '@/context/TabsContext';
import { isDesktop, onDesktopFile, onPrintDone, onSaveDone, setNativeTitle } from '@/lib/desktop';
import { toast } from '@/hooks/use-toast';
import UpdateBanner from '@/components/app/UpdateBanner';
import VersionGate from '@/components/app/VersionGate';

const Workspace = () => {
  const tabsApi = useTabs()!;
  const { tabs, activeId, openTab, activeTitle } = tabsApi;

  // Документ от программы открывается новой вкладкой: то, что уже открыто,
  // остаётся на месте
  useEffect(
    () =>
      onDesktopFile((d) => {
        if (d.url) openTab({ name: d.name, url: d.url, size: d.size });
        else if (d.file) openTab(d.file);
      }),
    [openTab],
  );

  useEffect(
    () =>
      onPrintDone((r) => {
        if (r.cancelled) return;
        if (r.ok) {
          toast({ title: 'Документ напечатан', description: r.printer || '' });
        } else if (r.error) {
          toast({ title: 'Не удалось напечатать', description: r.error });
        }
      }),
    [],
  );

  useEffect(
    () =>
      onSaveDone((r) => {
        if (r.cancelled) return;
        if (r.ok) {
          if (r.count && r.count > 1) {
            toast({ title: 'Файлы сохранены', description: `${r.count} шт. — ${r.path}` });
          } else {
            const file = (r.path || '').split(/[\\/]/).pop() || '';
            toast({ title: 'Файл сохранён', description: file });
          }
        } else if (r.error) {
          toast({ title: 'Не удалось сохранить', description: r.error });
        }
      }),
    [],
  );

  useEffect(() => {
    if (isDesktop()) {
      setNativeTitle(activeTitle ? `${activeTitle} — ПВ-Система PDF` : 'ПВ-Система PDF');
    }
  }, [activeTitle]);

  return (
    <AppWindow title={activeTitle ? `${activeTitle} — ПВ-Система PDF` : undefined}>
      <div className="flex h-full flex-col overflow-hidden bg-background font-body text-foreground">
        {tabs.length === 0 ? (
          // Пока ничего не открыто, показываем стартовый экран
          <DocProvider>
            <AppBar />
            <div className="flex-1 overflow-y-auto">
              <Dropzone />
            </div>
          </DocProvider>
        ) : (
          <>
            <TabsBar />
            {/* Открытые документы остаются в памяти: неактивная вкладка
                просто скрыта, поэтому возврат к ней происходит мгновенно */}
            {tabs.map((t) => (
              <div
                key={t.id}
                className={
                  t.id === activeId ? 'flex min-h-0 flex-1 flex-col' : 'hidden'
                }
              >
                <DocWorkspace source={t.source} tabId={t.id} activeTab={t.id === activeId} />
              </div>
            ))}
          </>
        )}
        <UpdateBanner />
        <VersionGate />
      </div>
    </AppWindow>
  );
};

const Index = () => (
  <LicenseProvider>
    <TabsProvider>
      <Workspace />
    </TabsProvider>
  </LicenseProvider>
);

export default Index;
