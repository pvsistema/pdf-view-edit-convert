// Запуск движка распознавания для «быстрых» задач — например, сразу
// после очистки скана. Настройки те же, что у полного распознавания
// в боковой панели: словари из программы, без интернета, нужное ядро
// под процессор
import { loadOcrModule } from '@/lib/secureModule';

type Worker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>;

let fastCore: boolean | null = null;

const canFast = async () => {
  if (fastCore !== null) return fastCore;
  try {
    await WebAssembly.instantiate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 98, 11,
      ]),
    );
    fastCore = true;
  } catch {
    fastCore = false;
  }
  return fastCore;
};

export const createOcrWorker = async (
  licenseKey: string,
  dpi: number,
  onProgress?: (p: number) => void,
): Promise<Worker> => {
  const mod = (await loadOcrModule(licenseKey)) as {
    createWorker: typeof import('tesseract.js').createWorker;
  };
  const base = new URL(`${import.meta.env.BASE_URL}tessdata`, location.href).href.replace(/\/$/, '');
  const fast = await canFast();

  const worker = await mod.createWorker('rus+eng', 1, {
    langPath: base,
    workerPath: `${base}/worker.min.js`,
    corePath: `${base}/core/tesseract-core${fast ? '-simd' : ''}-lstm.wasm.js`,
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none',
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });

  await worker.setParameters({
    preserve_interword_spaces: '1',
    user_defined_dpi: String(dpi),
    tessedit_pageseg_mode: '3' as never,
    thresholding_method: '2',
    thresholding_window_size: '0.5',
    thresholding_kfactor: '0.34',
  });
  return worker;
};

// Невидимый текстовый слой для листа. Возвращает одностраничный PDF
// только с текстом (без картинки) — её подложим свою, очищенную
export const textLayerOf = async (worker: Worker, sheet: HTMLCanvasElement) => {
  const { data } = await worker.recognize(sheet, { pdfTextOnly: true }, { pdf: true, text: true });
  return {
    pdf: data.pdf ? new Uint8Array(data.pdf) : null,
    text: (data.text || '').trim(),
  };
};
