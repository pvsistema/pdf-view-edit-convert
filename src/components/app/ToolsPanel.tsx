import { useState } from 'react';
import Icon from '@/components/ui/icon';
import { useDoc } from '@/context/DocContext';
import { canvasToBlob, downloadBlob, pageText, renderPage } from '@/lib/pdf';
import { toast } from '@/hooks/use-toast';
import { createWorker } from 'tesseract.js';

const baseName = (n: string) => n.replace(/\.pdf$/i, '') || 'document';

const ToolsPanel = () => {
  const { pages, name, active, docOf, buildPdf } = useDoc();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [ocrText, setOcrText] = useState('');

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setProgress(0);
    try {
      await fn();
    } catch (e) {
      toast({ title: 'Не удалось выполнить', description: 'Попробуйте другой файл или операцию' });
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  const collectText = async () => {
    const chunks: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const doc = docOf(pages[i]);
      if (!doc) continue;
      chunks.push(await pageText(doc, pages[i].src));
      setProgress(Math.round(((i + 1) / pages.length) * 100));
    }
    return chunks;
  };

  const toPdf = () =>
    run('pdf', async () => {
      const bytes = await buildPdf();
      downloadBlob(
        new Blob([bytes as BlobPart], { type: 'application/pdf' }),
        `${baseName(name)}-изменённый.pdf`,
      );
      toast({ title: 'Файл сохранён', description: 'Документ PDF со всеми изменениями' });
    });

  const toWord = () =>
    run('word', async () => {
      const chunks = await collectText();
      const body = chunks
        .map(
          (t, i) =>
            `<div style="page-break-after:always"><p>${t
              .split('\n')
              .map((l) => l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!))
              .join('</p><p>')}</p><small>Стр. ${i + 1}</small></div>`,
        )
        .join('');
      const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body style="font-family:Times New Roman,serif">${body}</body></html>`;
      downloadBlob(new Blob(['\ufeff', html], { type: 'application/msword' }), `${baseName(name)}.doc`);
      toast({ title: 'Готов файл Word', description: 'Открывается в Word и в редакторах документов' });
    });

  const toExcel = () =>
    run('excel', async () => {
      const chunks = await collectText();
      const rows = chunks
        .flatMap((t, i) =>
          t
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const cells = line.split(/\s{2,}|\t/).filter(Boolean);
              return `<tr><td>${i + 1}</td>${cells
                .map((c) => `<td>${c.replace(/[&<>]/g, '')}</td>`)
                .join('')}</tr>`;
            }),
        )
        .join('');
      const html = `<html><head><meta charset="utf-8"></head><body><table border="1"><tr><th>Стр.</th><th>Данные</th></tr>${rows}</table></body></html>`;
      downloadBlob(new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel' }), `${baseName(name)}.xls`);
      toast({ title: 'Готова таблица', description: 'Файл открывается в Excel' });
    });

  const toText = () =>
    run('text', async () => {
      const chunks = await collectText();
      const text = chunks.map((t, i) => `--- Страница ${i + 1} ---\n${t}`).join('\n\n');
      downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${baseName(name)}.txt`);
      toast({ title: 'Готов текстовый файл' });
    });

  const toImages = () =>
    run('jpg', async () => {
      for (let i = 0; i < pages.length; i++) {
        const doc = docOf(pages[i]);
        if (!doc) continue;
        const canvas = await renderPage(doc, pages[i].src, 2, pages[i].rotation);
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
        downloadBlob(blob, `${baseName(name)}-${String(i + 1).padStart(3, '0')}.jpg`);
        setProgress(Math.round(((i + 1) / pages.length) * 100));
        await new Promise((r) => setTimeout(r, 250));
      }
      toast({ title: 'Страницы сохранены', description: `${pages.length} изображений JPG` });
    });

  const splitCurrent = () =>
    run('split', async () => {
      const bytes = await buildPdf([pages[active]]);
      downloadBlob(
        new Blob([bytes as BlobPart], { type: 'application/pdf' }),
        `${baseName(name)}-страница-${active + 1}.pdf`,
      );
      toast({ title: 'Страница сохранена отдельным файлом' });
    });

  const runOcr = () =>
    run('ocr', async () => {
      const p = pages[active];
      const doc = docOf(p);
      if (!doc) return;
      const canvas = await renderPage(doc, p.src, 2, p.rotation);
      const worker = await createWorker('rus+eng', 1, {
        logger: (m: any) => {
          if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100));
        },
      });
      const { data } = await worker.recognize(canvas);
      await worker.terminate();
      setOcrText(data.text.trim());
      toast({ title: 'Текст распознан', description: `Страница ${active + 1}` });
    });

  const TOOLS = [
    { key: 'pdf', icon: 'Save', label: 'Сохранить PDF', note: 'Со всеми правками', fn: toPdf },
    { key: 'word', icon: 'FileText', label: 'В Word', note: 'Редактируемый документ', fn: toWord },
    { key: 'excel', icon: 'Table', label: 'В Excel', note: 'Таблица из документа', fn: toExcel },
    { key: 'jpg', icon: 'Image', label: 'В JPG', note: 'Каждая страница картинкой', fn: toImages },
    { key: 'text', icon: 'AlignLeft', label: 'В текст', note: 'Простой файл TXT', fn: toText },
    { key: 'split', icon: 'Scissors', label: 'Выделить страницу', note: 'Текущая — отдельным файлом', fn: splitCurrent },
    { key: 'ocr', icon: 'ScanText', label: 'Распознать (OCR)', note: 'Русский и английский', fn: runOcr },
  ];

  return (
    <aside className="flex h-full w-[290px] shrink-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <span className="label-caps">Инструменты</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            onClick={t.fn}
            disabled={!!busy}
            className="flex w-full items-start gap-3 border-b border-border px-4 py-4 text-left transition-colors hover:bg-background disabled:opacity-50"
          >
            <Icon
              name={busy === t.key ? 'LoaderCircle' : t.icon}
              size={18}
              className={`mt-0.5 shrink-0 text-primary ${busy === t.key ? 'animate-spin' : ''}`}
            />
            <span className="min-w-0">
              <span className="block font-head text-[0.92rem] font-bold uppercase tracking-[-0.01em]">
                {t.label}
              </span>
              <span className="mt-0.5 block text-[0.8rem] text-muted-foreground">{t.note}</span>
              {busy === t.key && progress > 0 && (
                <span className="mt-2 block h-1 w-full bg-border">
                  <span className="block h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </span>
              )}
            </span>
          </button>
        ))}

        {ocrText && (
          <div className="border-b border-border p-4">
            <div className="flex items-center justify-between">
              <span className="label-caps">Распознанный текст</span>
              <button
                className="text-primary hover:opacity-70"
                title="Скачать текст"
                onClick={() =>
                  downloadBlob(
                    new Blob([ocrText], { type: 'text/plain;charset=utf-8' }),
                    `${baseName(name)}-распознано.txt`,
                  )
                }
              >
                <Icon name="Download" size={15} />
              </button>
            </div>
            <textarea
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              rows={12}
              className="mt-3 w-full resize-y border border-border bg-background p-3 text-[0.82rem] leading-relaxed outline-none focus:border-primary"
            />
          </div>
        )}
      </div>
    </aside>
  );
};

export default ToolsPanel;