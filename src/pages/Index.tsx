import { useState } from "react";
import { DocProvider, useDoc } from "@/context/DocContext";
import Icon from "@/components/ui/icon";
import AppBar from "@/components/app/AppBar";
import Dropzone from "@/components/app/Dropzone";
import PagesPanel from "@/components/app/PagesPanel";
import Viewer, { type Tool } from "@/components/app/Viewer";
import ToolsPanel from "@/components/app/ToolsPanel";
import AppWindow from "@/components/app/AppWindow";
import { LicenseProvider } from "@/context/LicenseContext";
import { isDesktop, onDesktopFile, setNativeTitle } from "@/lib/desktop";
import UpdateBanner from "@/components/app/UpdateBanner";
import { useEffect } from "react";

const Workspace = () => {
  const { pages, name, open } = useDoc();
  const [tool, setTool] = useState<Tool>("hand");
  const [panel, setPanel] = useState<"pages" | "tools" | null>(null);

  useEffect(() => onDesktopFile((f) => open(f)), [open]);

  useEffect(() => {
    if (isDesktop()) {
      setNativeTitle(name ? `${name} — ПВ-Система PDF` : "ПВ-Система PDF");
    }
  }, [name]);

  return (
    <AppWindow title={name ? `${name} — ПВ-Система PDF` : undefined}>
      <div className="flex h-full flex-col overflow-hidden bg-background font-body text-foreground">
        <AppBar />
        {pages.length === 0 ? (
          <div className="flex-1 overflow-y-auto">
            <Dropzone />
          </div>
        ) : (
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
                  {panel === "pages" ? <PagesPanel /> : <ToolsPanel />}
                </div>
              </div>
            )}

            <div className="absolute bottom-4 right-4 z-30 flex gap-2 xl:hidden">
              <button
                onClick={() => setPanel(panel === "pages" ? null : "pages")}
                className="flex h-12 w-12 items-center justify-center border border-foreground bg-background lg:hidden"
                title="Страницы"
              >
                <Icon name="Files" size={20} />
              </button>
              <button
                onClick={() => setPanel(panel === "tools" ? null : "tools")}
                className="flex h-12 w-12 items-center justify-center bg-primary text-primary-foreground"
                title="Инструменты"
              >
                <Icon name="Wrench" size={20} />
              </button>
            </div>
          </div>
        )}
        <UpdateBanner />
      </div>
    </AppWindow>
  );
};

const Index = () => (
  <LicenseProvider>
    <DocProvider>
      <Workspace />
    </DocProvider>
  </LicenseProvider>
);

export default Index;